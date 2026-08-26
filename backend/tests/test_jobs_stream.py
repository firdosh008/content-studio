import contextlib

import pytest

from app.api.v1 import jobs
from app.workers import queue


@pytest.fixture(autouse=True)
def stream_reads_the_test_database(db_session, monkeypatch):
    monkeypatch.setattr(
        jobs, "session_factory", lambda: contextlib.nullcontext(db_session)
    )
    monkeypatch.setattr(jobs, "POLL_SECONDS", 0.01)


def test_job_snapshot_reflects_persisted_progress(
    client_admin, db_session, queued_artifact
):
    job = queue.claim(db_session)
    queue.report_progress(db_session, job.id, "generating", 42, "calling open-design")
    body = client_admin.get(f"/api/v1/artifacts/{queued_artifact}/job").json()
    assert body["state"] == "running"
    assert body["progress"]["percent"] == 42
    assert body["progress"]["detail"] == "calling open-design"


def test_snapshot_is_404_when_no_job_exists(client_admin, factory):
    artifact = factory.artifact()
    assert client_admin.get(
        f"/api/v1/artifacts/{artifact.id}/job"
    ).status_code == 404


def test_snapshot_is_404_for_an_unknown_artifact(client_admin):
    assert client_admin.get("/api/v1/artifacts/nope/job").status_code == 404


def test_stream_emits_progress_and_terminates_when_done(
    client_admin, db_session, queued_artifact
):
    job = queue.claim(db_session)
    queue.succeed(db_session, job.id)
    with client_admin.stream(
        "GET", f"/api/v1/artifacts/{queued_artifact}/job/stream"
    ) as response:
        text = "".join(response.iter_text())
    assert "data:" in text
    assert '"stage": "done"' in text


def test_stream_reports_a_failed_job_with_its_error(
    client_admin, db_session, queued_artifact
):
    job = queue.claim(db_session)
    queue.fail(db_session, job.id, "open-design unreachable", retryable=False)
    with client_admin.stream(
        "GET", f"/api/v1/artifacts/{queued_artifact}/job/stream"
    ) as response:
        text = "".join(response.iter_text())
    assert "open-design unreachable" in text
    assert '"state": "failed"' in text


def test_stream_is_404_when_no_job_exists(client_admin, factory):
    artifact = factory.artifact()
    response = client_admin.get(f"/api/v1/artifacts/{artifact.id}/job/stream")
    assert response.status_code == 404
