def test_member_cannot_create_a_brand(client_member):
    assert client_member.post(
        "/api/v1/brands", json={"name": "Agent Loopr"}
    ).status_code == 403


def test_admin_creates_a_brand_and_gets_a_slug(client_admin):
    response = client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    assert response.status_code == 201
    assert response.json()["slug"] == "agent-loopr"


def test_slugs_are_unique(client_admin):
    client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    response = client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    assert response.status_code == 409


def test_a_name_with_no_usable_characters_is_refused(client_admin):
    assert client_admin.post("/api/v1/brands", json={"name": "***"}).status_code == 422


def test_every_member_sees_every_brand(client):
    from app.db.models import Role

    client.as_role(Role.ADMIN)
    client.post("/api/v1/brands", json={"name": "Ladder"})
    client.as_role(Role.MEMBER)
    assert len(client.get("/api/v1/brands").json()) == 1
