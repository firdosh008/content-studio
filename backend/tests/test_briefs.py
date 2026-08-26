from app.db.models import Role


def test_a_brief_needs_a_real_brand(client_admin):
    response = client_admin.post(
        "/api/v1/briefs", json={"brand_id": "nope", "content": "x"}
    )
    assert response.status_code == 404


def test_briefs_are_listed_newest_first(client_admin):
    brand_id = client_admin.post(
        "/api/v1/brands", json={"name": "Ladder"}
    ).json()["id"]
    for content in ("first", "second"):
        client_admin.post(
            "/api/v1/briefs", json={"brand_id": brand_id, "content": content}
        )
    listed = client_admin.get(f"/api/v1/briefs?brand_id={brand_id}").json()
    assert [b["content"] for b in listed] == ["second", "first"]


def test_a_member_can_create_a_brief(client):
    client.as_role(Role.ADMIN)
    brand_id = client.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    client.as_role(Role.MEMBER)
    response = client.post(
        "/api/v1/briefs", json={"brand_id": brand_id, "content": "x"}
    )
    assert response.status_code == 201
    assert response.json()["source"] == "manual"
