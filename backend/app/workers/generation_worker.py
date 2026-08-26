"""The generation worker process.

One artifact per job. Progress is written to the job row at each stage so a
member who reconnects sees where things are (PRD 7.1). Concurrency is capped by
running N worker containers, where N matches how many open-design daemons
exist: a single daemon serialises, so the default is 1.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy.orm import Session

from app.api.v1.contracts import latest_design
from app.core.config import settings
from app.db.models import (
    Artifact,
    ArtifactStatus,
    Brand,
    Copy,
    GenerationJob,
    JobState,
    ModelProvider,
)
from app.db.session import SessionLocal
from app.services import brand_sync
from app.services import open_design as od
from app.workers import queue

logger = logging.getLogger(__name__)
POLL_SECONDS = 2


def _build_request(db: Session, artifact: Artifact) -> od.GenerationRequest:
    brand = db.get(Brand, artifact.brand_id)
    design = latest_design(db, artifact.brand_id)
    provider = db.get(ModelProvider, artifact.model_provider_id)
    copy_row = db.get(Copy, artifact.copy_id) if artifact.copy_id else None
    return od.GenerationRequest(
        brand_slug=brand.slug,
        artifact_type=artifact.artifact_type.value,
        mode=artifact.generation_mode.value,
        copy_text=copy_row.content if copy_row else "",
        design_md=design.design_md_content if design else "",
        reference_specs=[],  # filled in by Task 20
        asset_paths=[],  # filled in by Task 20
        skill_paths=[],  # filled in by Task 20
        model_name=provider.name if provider else "",
        variant_index=artifact.version,
    )


def run_job(db: Session, job: GenerationJob) -> None:
    artifact = db.get(Artifact, job.artifact_id)
    if artifact is None:
        queue.fail(db, job.id, "artifact vanished", retryable=False)
        return

    artifact.status = ArtifactStatus.GENERATING
    db.commit()

    try:
        queue.report_progress(db, job.id, "syncing_brand", 10)
        brand = db.get(Brand, artifact.brand_id)
        brand_sync.sync_brand(db, brand)
        brand_sync.sync_skills(db)

        queue.report_progress(
            db, job.id, "generating", 30, "calling open-design"
        )
        if artifact.edit_instruction and artifact.open_design_project_ref:
            outcome = od.edit(
                artifact.open_design_project_ref, artifact.edit_instruction
            )
        else:
            outcome = od.generate(_build_request(db, artifact))

        artifact.open_design_project_ref = (
            outcome.project_ref or artifact.open_design_project_ref
        )
        artifact.export_urls = outcome.export_urls
        db.commit()

        queue.report_progress(db, job.id, "qa", 70, "running quality checks")
        _run_qa(db, artifact)

        queue.report_progress(db, job.id, "done", 100)
        queue.succeed(db, job.id)
    except od.OpenDesignError as exc:
        logger.warning("generation failed for %s: %s", artifact.id, exc)
        queue.fail(db, job.id, str(exc), retryable=True)
        db.refresh(job)
        artifact.status = (
            ArtifactStatus.FAILED
            if job.state == JobState.FAILED
            else ArtifactStatus.QUEUED
        )
        db.commit()


def _run_qa(db: Session, artifact: Artifact) -> None:
    """Placeholder until Task 23 wires the real gate. Marks the artifact ready."""
    artifact.status = ArtifactStatus.READY
    db.commit()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info(
        "generation worker up; concurrency cap is %s per daemon",
        settings.MAX_CONCURRENT_GENERATIONS,
    )
    while True:
        with SessionLocal() as db:
            job = queue.claim(db)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            run_job(db, job)


if __name__ == "__main__":
    main()
