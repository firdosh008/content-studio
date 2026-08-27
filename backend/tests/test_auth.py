import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.security import current_user, require_admin
from app.db.models import Role, User
from app.main import app


def _fake_user(role: Role = Role.MEMBER) -> User:
    return User(
        id="u1",
        organization_id="o1",
        email="a@b.com",
        auth_ref="sub-1",
        role=role,
    )


def test_me_requires_a_token():
    with TestClient(app) as client:
        assert client.get("/api/v1/me").status_code == 403


def test_me_returns_the_caller():
    app.dependency_overrides[current_user] = lambda: _fake_user()
    with TestClient(app) as client:
        body = client.get("/api/v1/me").json()
    app.dependency_overrides.clear()
    assert body["email"] == "a@b.com"
    assert body["role"] == "member"


def test_admin_only_route_rejects_a_member():
    with pytest.raises(HTTPException) as exc:
        require_admin(user=_fake_user(Role.MEMBER))
    assert exc.value.status_code == 403
