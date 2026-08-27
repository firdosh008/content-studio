"""Reconnectable generation progress.

SSE over a database poll, not websockets and not Redis pub/sub. Progress
already lives in a row (PRD 7.1), so a reconnecting client just reads it again
and the server holds no per-connection state worth losing.
"""

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.artifacts import get_artifact
from app.core.security import current_user
from app.db.models import GenerationJob, JobState, User
from app.db.session import SessionLocal, get_db

router = APIRouter(prefix="/artifacts/{artifact_id}/job", tags=["jobs"])

TERMINAL = {JobState.SUCCEEDED, JobState.FAILED}
POLL_SECONDS = 1.0
MAX_STREAM_SECONDS = 1800

# The stream outlives the request, so it cannot hold the request's session.
# Indirection here lets tests point it at their in-memory database.
session_factory = SessionLocal


def _latest_job_query(artifact_id: str):
    return (
        select(GenerationJob)
        .where(GenerationJob.artifact_id == artifact_id)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(1)
    )


def _latest_job(db: Session, artifact_id: str) -> GenerationJob:
    job = db.scalar(_latest_job_query(artifact_id))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no job for this artifact")
    return job


def _snapshot(job: GenerationJob) -> dict:
    return {
        "job_id": job.id,
        "state": job.state.value,
        "attempts": job.attempts,
        "progress": job.progress_ref or {},
        "error": job.error,
    }


@router.get("")
def job_snapshot(
    artifact_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> dict:
    get_artifact(db, artifact_id)
    return _snapshot(_latest_job(db, artifact_id))


@router.get("/stream")
def job_stream(
    artifact_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> StreamingResponse:
    get_artifact(db, artifact_id)
    _latest_job(db, artifact_id)  # 404 now rather than inside the stream

    async def events():
        last = None
        elapsed = 0.0
        while elapsed < MAX_STREAM_SECONDS:
            with session_factory() as session:
                job = session.scalar(_latest_job_query(artifact_id))
                if job is None:
                    break
                payload = _snapshot(job)
                if payload != last:
                    yield f"data: {json.dumps(payload)}\n\n"
                    last = payload
                if job.state in TERMINAL:
                    break
            await asyncio.sleep(POLL_SECONDS)
            elapsed += POLL_SECONDS

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
