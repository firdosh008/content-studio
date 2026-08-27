from app.db.models import Artifact, ArtifactStatus
from app.workers import generation_worker, queue


def test_run_job_marks_the_artifact_ready(
    db_session, queued_artifact, fake_open_design, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    artifact = db_session.get(Artifact, queued_artifact)
    assert artifact.status == ArtifactStatus.READY
    assert artifact.open_design_project_ref == "proj_42"
    assert artifact.export_urls == {"png": "http://od/e/1.png"}


def test_a_daemon_failure_requeues_before_the_last_attempt(
    db_session, queued_artifact, broken_open_design, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert db_session.get(Artifact, queued_artifact).status == ArtifactStatus.QUEUED


def test_a_daemon_failure_fails_the_artifact_after_retries(
    db_session, queued_artifact, broken_open_design, tmp_shared_volume
):
    for _ in range(queue.MAX_ATTEMPTS):
        job = queue.claim(db_session)
        generation_worker.run_job(db_session, job)
    assert db_session.get(Artifact, queued_artifact).status == ArtifactStatus.FAILED


def test_progress_advances_through_named_stages(
    db_session, queued_artifact, fake_open_design, progress_log, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert [stage for stage, _ in progress_log] == [
        "syncing_brand",
        "generating",
        "qa",
        "done",
    ]


def test_an_iteration_calls_edit_not_generate(
    db_session, iterating_artifact, fake_open_design, call_log, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert call_log == ["edit"]


def test_a_first_generation_calls_generate_not_edit(
    db_session, queued_artifact, fake_open_design, call_log, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert call_log == ["generate"]


def test_the_payload_carries_copy_and_design(
    db_session, queued_artifact, capture_request, tmp_shared_volume
):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    request = capture_request["request"]
    assert request.copy_text == "Words."
    assert request.design_md == "# D"
    assert request.brand_slug == "ladder"
    assert request.model_name == "claude"


def test_the_database_refuses_to_orphan_a_job(db_session, factory):
    """run_job guards against a missing artifact, but the schema makes that
    unreachable: the foreign key is the real protection, and this is the test
    that says so. The guard stays as a crash-loop backstop for a manual DELETE.
    """
    import pytest
    from sqlalchemy.exc import IntegrityError

    artifact = factory.artifact()
    queue.enqueue(db_session, artifact.id)
    db_session.delete(artifact)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
