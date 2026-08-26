import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import LADDER_ORG_ID, current_user
from app.db.models import Base, Organization, Role, User
from app.db.session import get_db
from app.main import app


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite ignores foreign keys unless told otherwise, and a test suite that
    # tolerates dangling references will not catch the ones Postgres rejects.
    @event.listens_for(engine, "connect")
    def _enforce_fks(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    with maker() as session:
        session.add(Organization(id=LADDER_ORG_ID, name="Ladder"))
        session.commit()
        yield session


def _make_users(db_session) -> dict:
    users = {}
    for role in (Role.ADMIN, Role.MEMBER):
        user = User(
            id=f"u-{role.value}",
            organization_id=LADDER_ORG_ID,
            email=f"{role.value}@ladder.com",
            auth_ref=f"sub-{role.value}",
            role=role,
        )
        db_session.add(user)
        users[role] = user
    db_session.commit()
    return users


@pytest.fixture
def client(db_session):
    """One client whose identity switches with client.as_role(...).

    FastAPI's dependency_overrides is app-global, so two TestClients cannot
    hold two identities at once - the second override silently wins for both.
    One client reading a mutable box is the only shape that does not lie.
    """
    users = _make_users(db_session)
    box = {"user": users[Role.ADMIN]}
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[current_user] = lambda: box["user"]

    test_client = TestClient(app)
    test_client.as_role = lambda role: box.__setitem__("user", users[role])
    test_client.users = users
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def client_admin(client):
    client.as_role(Role.ADMIN)
    return client


@pytest.fixture
def client_member(client):
    client.as_role(Role.MEMBER)
    return client


@pytest.fixture
def fake_storage(monkeypatch):
    """In-memory stand-in.

    Storage is a thin wrapper; hitting the network in unit tests would test
    Supabase, not us.
    """
    from app.services import storage

    store: dict[str, bytes] = {}
    monkeypatch.setattr(
        storage, "_put_bytes", lambda k, d, c: store.__setitem__(k, d)
    )
    monkeypatch.setattr(storage, "_get_bytes", lambda k: store[k])
    monkeypatch.setattr(storage, "_remove", lambda k: store.pop(k, None))
    monkeypatch.setattr(
        storage, "_sign", lambda k, s: f"https://signed.example/{k}?e={s}"
    )
    return store


@pytest.fixture
def tmp_shared_volume(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "SHARED_VOLUME_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def stub_copy_model(db_session, monkeypatch):
    from app.core.security import LADDER_ORG_ID
    from app.db.models import ModelProvider, ProviderType
    from app.services import copy_gen

    provider = ModelProvider(
        organization_id=LADDER_ORG_ID,
        type=ProviderType.CODING_AGENT,
        name="claude",
        credential_ref="vault://claude",
    )
    db_session.add(provider)
    db_session.commit()
    # Stub the network boundary, not our own function: copy_gen's VOICE.md
    # guard must still run, or the test that asserts it is testing the stub.
    monkeypatch.setattr(
        copy_gen.od,
        "complete",
        lambda model, system, prompt: "Generated copy.",
    )
    return provider.id


@pytest.fixture
def factory(db_session):
    """Builds the real rows an Artifact needs.

    Foreign keys are enforced in these tests, so nothing here fakes an id.
    """
    from app.db.models import (
        Artifact,
        ArtifactStatus,
        ArtifactType,
        Brand,
        Brief,
        Copy,
        CopyStatus,
        GenerationMode,
        ModelProvider,
        ProviderType,
    )

    class Factory:
        def __init__(self):
            self.users = _make_users(db_session)
            self.user = self.users[Role.ADMIN]

        def brand(self, name="Ladder", slug="ladder"):
            row = Brand(organization_id=LADDER_ORG_ID, name=name, slug=slug,
                        created_by=self.user.id)
            db_session.add(row)
            db_session.commit()
            return row

        def provider(self, kind=ProviderType.CODING_AGENT, name="claude"):
            row = ModelProvider(organization_id=LADDER_ORG_ID, type=kind,
                                name=name, credential_ref="vault://k")
            db_session.add(row)
            db_session.commit()
            return row

        def brief(self, brand, content="launch"):
            row = Brief(brand_id=brand.id, created_by=self.user.id,
                        content=content, source="manual")
            db_session.add(row)
            db_session.commit()
            return row

        def copy(self, brief, approved=True, content="Words."):
            row = Copy(
                brief_id=brief.id, brand_id=brief.brand_id, content=content,
                status=CopyStatus.APPROVED if approved else CopyStatus.DRAFT,
                approved_by=self.user.id if approved else None,
                version=1, created_by=self.user.id,
            )
            db_session.add(row)
            db_session.commit()
            return row

        def artifact(self, artifact_type=ArtifactType.CAROUSEL,
                     status=ArtifactStatus.QUEUED, brand=None, **kwargs):
            brand = brand or self.brand()
            brief = self.brief(brand)
            row = Artifact(
                brand_id=brand.id, brief_id=brief.id,
                copy_id=self.copy(brief).id, artifact_type=artifact_type,
                generation_mode=(GenerationMode.IMAGE
                                 if artifact_type == ArtifactType.IMAGE
                                 else GenerationMode.CODE),
                model_provider_id=self.provider().id, status=status,
                version=1, created_by=self.user.id, **kwargs,
            )
            db_session.add(row)
            db_session.commit()
            return row

    return Factory()


@pytest.fixture
def artifact_pair(factory):
    """Two artifacts on one brand, oldest first."""
    brand = factory.brand()
    return [factory.artifact(brand=brand).id for _ in range(2)]


@pytest.fixture
def call_log():
    return []


@pytest.fixture
def fake_open_design(monkeypatch, call_log):
    from app.services import open_design as od

    outcome = od.GenerationOutcome(
        project_ref="proj_42",
        export_urls={"png": "http://od/e/1.png"},
        log="ok",
    )

    def _generate(req):
        call_log.append("generate")
        return outcome

    def _edit(ref, message):
        call_log.append("edit")
        return outcome

    monkeypatch.setattr(od, "generate", _generate)
    monkeypatch.setattr(od, "edit", _edit)
    return outcome


@pytest.fixture
def capture_request(monkeypatch):
    """Records the GenerationRequest the worker actually builds."""
    from app.services import open_design as od

    seen: dict = {}

    def _generate(req):
        seen["request"] = req
        return od.GenerationOutcome("proj_42", {"png": "http://od/e/1.png"}, "")

    monkeypatch.setattr(od, "generate", _generate)
    return seen


@pytest.fixture
def broken_open_design(monkeypatch):
    from app.services import open_design as od

    def boom(*_args, **_kwargs):
        raise od.OpenDesignError("daemon down")

    monkeypatch.setattr(od, "generate", boom)
    monkeypatch.setattr(od, "edit", boom)


@pytest.fixture
def progress_log(monkeypatch):
    from app.workers import queue as q

    log: list[tuple[str, int]] = []
    original = q.report_progress

    def spy(db, job_id, stage, percent, detail=""):
        log.append((stage, percent))
        original(db, job_id, stage, percent, detail)

    monkeypatch.setattr(q, "report_progress", spy)
    return log


def _artifact_with_contracts(db_session, factory):
    from app.db.models import DesignSystem

    brand = factory.brand()
    db_session.add(
        DesignSystem(brand_id=brand.id, design_md_content="# D", version=1)
    )
    db_session.commit()
    return factory.artifact(brand=brand)


@pytest.fixture
def queued_artifact(db_session, factory):
    from app.workers import queue as q

    artifact = _artifact_with_contracts(db_session, factory)
    q.enqueue(db_session, artifact.id)
    return artifact.id


@pytest.fixture
def iterating_artifact(db_session, factory):
    from app.workers import queue as q

    artifact = _artifact_with_contracts(db_session, factory)
    artifact.open_design_project_ref = "proj_42"
    artifact.edit_instruction = "bigger headline"
    db_session.commit()
    q.enqueue(db_session, artifact.id)
    return artifact.id
