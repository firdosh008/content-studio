from app.db.models import Role


def _brand(client) -> str:
    return client.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]


def test_design_starts_empty(client_admin):
    brand_id = _brand(client_admin)
    body = client_admin.get(f"/api/v1/brands/{brand_id}/design").json()
    assert body["content"] == ""
    assert body["version"] == 0


def test_put_design_creates_version_one(client_admin):
    brand_id = _brand(client_admin)
    response = client_admin.put(
        f"/api/v1/brands/{brand_id}/design", json={"content": "# Ladder"}
    )
    assert response.json()["version"] == 1


def test_second_put_bumps_the_version(client_admin):
    brand_id = _brand(client_admin)
    client_admin.put(f"/api/v1/brands/{brand_id}/design", json={"content": "# a"})
    response = client_admin.put(
        f"/api/v1/brands/{brand_id}/design", json={"content": "# b"}
    )
    assert response.json()["version"] == 2
    assert response.json()["content"] == "# b"


def test_voice_is_independent_of_design(client_admin):
    brand_id = _brand(client_admin)
    client_admin.put(f"/api/v1/brands/{brand_id}/design", json={"content": "# d"})
    response = client_admin.put(
        f"/api/v1/brands/{brand_id}/voice", json={"content": "# v"}
    )
    assert response.json()["version"] == 1


def test_member_cannot_edit_a_contract(client):
    client.as_role(Role.ADMIN)
    brand_id = _brand(client)
    client.as_role(Role.MEMBER)
    response = client.put(
        f"/api/v1/brands/{brand_id}/design", json={"content": "x"}
    )
    assert response.status_code == 403


def test_a_contract_on_an_unknown_brand_is_404(client_admin):
    assert client_admin.get("/api/v1/brands/nope/design").status_code == 404
