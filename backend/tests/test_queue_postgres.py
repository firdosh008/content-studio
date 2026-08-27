"""Concurrency proof for the SKIP LOCKED claim.

SQLite treats with_for_update as a no-op, so the state-machine tests in
test_queue.py cannot show what happens when two workers race. This one needs a
real Postgres and is skipped without TEST_DATABASE_URL.

Threads are deliberately not used: two threads that happen to run in sequence
pass a naive race test even with no locking at all. Holding one transaction
open while a second connection tries to claim tests the actual property.
"""

import os

from sqlalchemy import select
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import (
    Artifact,
    ArtifactStatus,
    ArtifactType,
    Base,
    Brand,
    GenerationJob,
    Brief,
    GenerationMode,
    JobState,
    ModelProvider,
    Organization,
    ProviderType,
    Role,
    User,
)
from app.workers import queue

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="needs a real postgres"
)

ORG_ID = "00000000-0000-0000-0000-000000000001"


def _seed(maker) -> str:
    with maker() as session:
        session.add(Organization(id=ORG_ID, name="Ladder"))
        user = User(
            organization_id=ORG_ID,
            email="a@ladder.com",
            auth_ref="sub-a",
            role=Role.ADMIN,
        )
        session.add(user)
        session.flush()
        brand = Brand(
            organization_id=ORG_ID, name="Ladder", slug="ladder",
            created_by=user.id,
        )
        provider = ModelProvider(
            organization_id=ORG_ID, type=ProviderType.CODING_AGENT,
            name="claude", credential_ref="vault://k",
        )
        session.add_all([brand, provider])
        session.flush()
        brief = Brief(brand_id=brand.id, created_by=user.id, content="x")
        session.add(brief)
        session.flush()
        artifact = Artifact(
            brand_id=brand.id, brief_id=brief.id,
            artifact_type=ArtifactType.CAROUSEL,
            generation_mode=GenerationMode.CODE,
            model_provider_id=provider.id, status=ArtifactStatus.QUEUED,
            created_by=user.id,
        )
        session.add(artifact)
        session.commit()
        return artifact.id


def _engine():
    engine = create_engine(os.environ["TEST_DATABASE_URL"])
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return engine


def test_a_locked_job_is_skipped_rather_than_waited_on():
    """The property SKIP LOCKED actually buys.

    Without it, a second worker blocks on the first worker's row lock for the
    whole length of a multi-minute generation. With it, the second worker moves
    straight to the next job.
    """
    maker = sessionmaker(bind=_engine(), expire_on_commit=False)
    artifact_id = _seed(maker)
    with maker() as session:
        queue.enqueue(session, artifact_id)

    # Worker A takes the lock and holds the transaction open.
    session_a = maker()
    claimed = session_a.scalar(
        select(GenerationJob)
        .where(GenerationJob.state == JobState.QUEUED)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    assert claimed is not None

    # Worker B, on its own connection, must return immediately with nothing.
    with maker() as session_b:
        assert queue.claim(session_b) is None

    session_a.rollback()
    session_a.close()


def test_the_released_job_is_claimable_again():
    maker = sessionmaker(bind=_engine(), expire_on_commit=False)
    artifact_id = _seed(maker)
    with maker() as session:
        queue.enqueue(session, artifact_id)

    session_a = maker()
    session_a.scalar(
        select(GenerationJob)
        .where(GenerationJob.state == JobState.QUEUED)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    session_a.rollback()
    session_a.close()

    with maker() as session_b:
        assert queue.claim(session_b) is not None
