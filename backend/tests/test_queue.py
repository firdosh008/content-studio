from app.db.models import JobState
from app.workers import queue


def test_enqueue_creates_a_queued_job(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    assert job.state == JobState.QUEUED
    assert job.attempts == 0


def test_claim_returns_the_oldest_queued_job_and_marks_it_running(
    db_session, artifact_pair
):
    first, second = artifact_pair
    queue.enqueue(db_session, first)
    queue.enqueue(db_session, second)
    job = queue.claim(db_session)
    assert job.artifact_id == first
    assert job.state == JobState.RUNNING
    assert job.started_at is not None
    assert job.attempts == 1


def test_claim_returns_none_when_the_queue_is_empty(db_session):
    assert queue.claim(db_session) is None


def test_a_claimed_job_is_not_claimed_twice(db_session, artifact_pair):
    queue.enqueue(db_session, artifact_pair[0])
    queue.claim(db_session)
    assert queue.claim(db_session) is None


def test_progress_is_readable_by_a_reconnecting_client(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    queue.claim(db_session)
    queue.report_progress(db_session, job.id, "generating", 40, "calling open-design")
    db_session.refresh(job)
    assert job.progress_ref["stage"] == "generating"
    assert job.progress_ref["percent"] == 40
    assert job.progress_ref["detail"] == "calling open-design"


def test_progress_percent_is_clamped(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    queue.report_progress(db_session, job.id, "generating", 500)
    db_session.refresh(job)
    assert job.progress_ref["percent"] == 100


def test_a_retryable_failure_returns_the_job_to_the_queue(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    queue.claim(db_session)
    queue.fail(db_session, job.id, "daemon timeout", retryable=True)
    db_session.refresh(job)
    assert job.state == JobState.QUEUED


def test_a_job_stops_retrying_after_max_attempts(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    for _ in range(queue.MAX_ATTEMPTS):
        queue.claim(db_session)
        queue.fail(db_session, job.id, "boom", retryable=True)
    db_session.refresh(job)
    assert job.state == JobState.FAILED
    assert job.error == "boom"


def test_an_unretryable_failure_fails_immediately(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    queue.claim(db_session)
    queue.fail(db_session, job.id, "artifact vanished", retryable=False)
    db_session.refresh(job)
    assert job.state == JobState.FAILED


def test_success_marks_the_job_done(db_session, artifact_pair):
    job = queue.enqueue(db_session, artifact_pair[0])
    queue.claim(db_session)
    queue.succeed(db_session, job.id)
    db_session.refresh(job)
    assert job.state == JobState.SUCCEEDED
    assert job.finished_at is not None
    assert job.progress_ref["percent"] == 100
