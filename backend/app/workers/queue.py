"""Durable generation queue on Postgres.

PRD 7.1: agentic generation of a deck takes minutes, so generation cannot be
request/response and jobs must survive an app restart. The GenerationJob table
is already in the schema, so SELECT ... FOR UPDATE SKIP LOCKED gives a correct
multi-worker queue with no broker to run, monitor or pay for.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GenerationJob, JobState

MAX_ATTEMPTS = 3


def _now() -> datetime:
    return datetime.now(UTC)


def enqueue(db: Session, artifact_id: str) -> GenerationJob:
    job = GenerationJob(
        artifact_id=artifact_id,
        state=JobState.QUEUED,
        progress_ref={"stage": "queued", "percent": 0, "detail": ""},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim(db: Session) -> GenerationJob | None:
    """Take one queued job. SKIP LOCKED lets N workers poll the same table."""
    job = db.scalar(
        select(GenerationJob)
        .where(GenerationJob.state == JobState.QUEUED)
        .order_by(GenerationJob.created_at, GenerationJob.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job is None:
        return None
    job.state = JobState.RUNNING
    job.started_at = _now()
    job.attempts += 1
    job.progress_ref = {"stage": "starting", "percent": 1, "detail": ""}
    db.commit()
    db.refresh(job)
    return job


def report_progress(
    db: Session, job_id: str, stage: str, percent: int, detail: str = ""
) -> None:
    """Progress lives in the row, not in memory.

    That is what makes the stream reconnectable (PRD 7.1): a member who closes
    a laptop and returns reads the same row the worker has been writing.
    """
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.progress_ref = {
        "stage": stage,
        "percent": max(0, min(100, percent)),
        "detail": detail,
        "at": _now().isoformat(),
    }
    db.commit()


def succeed(db: Session, job_id: str) -> None:
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.state = JobState.SUCCEEDED
    job.finished_at = _now()
    job.progress_ref = {"stage": "done", "percent": 100, "detail": ""}
    db.commit()


def fail(db: Session, job_id: str, error: str, retryable: bool = True) -> None:
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.error = error
    if retryable and job.attempts < MAX_ATTEMPTS:
        job.state = JobState.QUEUED
        job.started_at = None
    else:
        job.state = JobState.FAILED
        job.finished_at = _now()
    db.commit()
