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
