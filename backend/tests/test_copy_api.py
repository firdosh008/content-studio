from app.db.models import Role


def _setup(client) -> tuple[str, str]:
    client.as_role(Role.ADMIN)
    brand_id = client.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    client.put(
        f"/api/v1/brands/{brand_id}/voice", json={"content": "# Voice\nBlunt."}
    )
    brief_id = client.post(
        "/api/v1/briefs", json={"brand_id": brand_id, "content": "launch"}
    ).json()["id"]
    return brand_id, brief_id


def test_member_can_paste_copy_directly(client, stub_copy_model):
    _, brief_id = _setup(client)
    client.as_role(Role.MEMBER)
    response = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"content": "Hand written.", "generate": False},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "draft"
    assert response.json()["generated_by_model_id"] is None


def test_generated_copy_records_the_model(client, stub_copy_model):
    _, brief_id = _setup(client)
    response = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"generate": True, "model_provider_id": stub_copy_model},
    )
    assert response.status_code == 201
    assert response.json()["generated_by_model_id"] == stub_copy_model
    assert response.json()["content"] == "Generated copy."


def test_editing_copy_bumps_version_and_resets_to_draft(client, stub_copy_model):
    _, brief_id = _setup(client)
    copy_id = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"content": "a", "generate": False},
    ).json()["id"]
    client.post(f"/api/v1/copy/{copy_id}/approve")
    response = client.patch(f"/api/v1/copy/{copy_id}", json={"content": "b"})
    assert response.json()["version"] == 2
    assert response.json()["status"] == "draft"
    assert response.json()["approved_by"] is None


def test_member_cannot_approve_copy(client, stub_copy_model):
    _, brief_id = _setup(client)
    client.as_role(Role.MEMBER)
    copy_id = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"content": "a", "generate": False},
    ).json()["id"]
    assert client.post(f"/api/v1/copy/{copy_id}/approve").status_code == 403


def test_generation_without_voice_md_is_refused(client, stub_copy_model):
    client.as_role(Role.ADMIN)
    brand_id = client.post("/api/v1/brands", json={"name": "NoVoice"}).json()["id"]
    brief_id = client.post(
        "/api/v1/briefs", json={"brand_id": brand_id, "content": "x"}
    ).json()["id"]
    response = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"generate": True, "model_provider_id": stub_copy_model},
    )
    assert response.status_code == 422
    assert "VOICE.md" in response.json()["detail"]


def test_generate_without_a_model_is_rejected_by_the_schema(client, stub_copy_model):
    _, brief_id = _setup(client)
    response = client.post(
        f"/api/v1/briefs/{brief_id}/copy", json={"generate": True}
    )
    assert response.status_code == 422


def test_a_disabled_model_cannot_generate(client, stub_copy_model, db_session):
    from app.db.models import ModelProvider

    _, brief_id = _setup(client)
    db_session.get(ModelProvider, stub_copy_model).enabled = False
    db_session.commit()
    response = client.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"generate": True, "model_provider_id": stub_copy_model},
    )
    assert response.status_code == 422
