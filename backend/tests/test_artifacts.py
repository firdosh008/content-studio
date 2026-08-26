import pytest


@pytest.fixture
def ready(client_admin, db_session):
    """A brand with contracts, a brief, unapproved copy, and both providers."""
    from app.core.security import LADDER_ORG_ID
    from app.db.models import ModelProvider, ProviderType

    brand_id = client_admin.post(
        "/api/v1/brands", json={"name": "Ladder"}
    ).json()["id"]
    client_admin.put(f"/api/v1/brands/{brand_id}/design", json={"content": "# D"})
    client_admin.put(f"/api/v1/brands/{brand_id}/voice", json={"content": "# V"})
    brief_id = client_admin.post(
        "/api/v1/briefs", json={"brand_id": brand_id, "content": "launch"}
    ).json()["id"]
    copy_id = client_admin.post(
        f"/api/v1/briefs/{brief_id}/copy",
        json={"content": "Words.", "generate": False},
    ).json()["id"]

    providers = {}
    for kind, name in (
        (ProviderType.CODING_AGENT, "claude"),
        (ProviderType.IMAGE_PROVIDER, "gpt-image-2"),
    ):
        row = ModelProvider(
            organization_id=LADDER_ORG_ID,
            type=kind,
            name=name,
            credential_ref="vault://k",
        )
        db_session.add(row)
        providers[kind] = row
    db_session.commit()

    return {
        "brand_id": brand_id,
        "brief_id": brief_id,
        "copy_id": copy_id,
        "coding": providers[ProviderType.CODING_AGENT].id,
        "image": providers[ProviderType.IMAGE_PROVIDER].id,
    }


def _create(client, ready, **overrides):
    body = {
        "brand_id": ready["brand_id"],
        "brief_id": ready["brief_id"],
        "copy_id": ready["copy_id"],
        "artifact_type": "carousel",
        "model_provider_id": ready["coding"],
    }
    body.update(overrides)
    return client.post("/api/v1/artifacts", json=body)


def test_design_is_refused_while_copy_is_draft(client_admin, ready):
    response = _create(client_admin, ready)
    assert response.status_code == 409
    assert "approved" in response.json()["detail"]


def test_approved_copy_produces_a_queued_artifact(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    response = _create(client_admin, ready)
    assert response.status_code == 201
    assert response.json()[0]["status"] == "queued"
    assert response.json()[0]["generation_mode"] == "code"


def test_image_type_selects_image_mode(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    response = _create(
        client_admin, ready, artifact_type="image",
        model_provider_id=ready["image"],
    )
    assert response.json()[0]["generation_mode"] == "image"


def test_a_carousel_cannot_use_an_image_provider(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    response = _create(client_admin, ready, model_provider_id=ready["image"])
    assert response.status_code == 422
    assert "coding_agent" in response.json()["detail"]


def test_an_unknown_artifact_type_is_refused(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    response = _create(client_admin, ready, artifact_type="contract")
    assert response.status_code == 422


def test_variants_share_a_group_id(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    rows = _create(client_admin, ready, variants=3).json()
    assert len(rows) == 3
    assert len({row["variant_group_id"] for row in rows}) == 1


def test_a_single_artifact_has_no_variant_group(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    assert _create(client_admin, ready).json()[0]["variant_group_id"] is None


def test_variants_are_capped(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    assert _create(client_admin, ready, variants=99).status_code == 422


def test_every_artifact_gets_a_job(client_admin, ready, db_session):
    from app.db.models import GenerationJob

    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    _create(client_admin, ready, variants=2)
    assert db_session.query(GenerationJob).count() == 2


def test_iterating_an_ungenerated_artifact_is_refused(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    artifact_id = _create(client_admin, ready).json()[0]["id"]
    response = client_admin.post(
        f"/api/v1/artifacts/{artifact_id}/iterate", json={"instruction": "bigger"}
    )
    assert response.status_code == 409


def test_iteration_creates_a_child_version(client_admin, ready, db_session):
    from app.db.models import Artifact

    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    artifact_id = _create(client_admin, ready).json()[0]["id"]
    db_session.get(Artifact, artifact_id).open_design_project_ref = "proj_42"
    db_session.commit()

    child = client_admin.post(
        f"/api/v1/artifacts/{artifact_id}/iterate",
        json={"instruction": "bigger headline"},
    ).json()
    assert child["version"] == 2
    assert child["parent_artifact_id"] == artifact_id
    assert child["status"] == "queued"


def test_lineage_returns_the_chain_oldest_first(client_admin, ready, db_session):
    from app.db.models import Artifact

    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    root = _create(client_admin, ready).json()[0]["id"]
    ids = [root]
    for _ in range(2):
        db_session.get(Artifact, ids[-1]).open_design_project_ref = "proj_42"
        db_session.commit()
        ids.append(
            client_admin.post(
                f"/api/v1/artifacts/{ids[-1]}/iterate",
                json={"instruction": "again"},
            ).json()["id"]
        )

    chain = client_admin.get(f"/api/v1/artifacts/{ids[-1]}/lineage").json()
    assert [row["id"] for row in chain] == ids
    assert [row["version"] for row in chain] == [1, 2, 3]


def test_lineage_of_a_root_artifact_is_just_itself(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    artifact_id = _create(client_admin, ready).json()[0]["id"]
    chain = client_admin.get(f"/api/v1/artifacts/{artifact_id}/lineage").json()
    assert [row["id"] for row in chain] == [artifact_id]


def test_variants_endpoint_returns_every_sibling(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    rows = _create(client_admin, ready, variants=3).json()
    siblings = client_admin.get(
        f"/api/v1/artifacts/{rows[0]['id']}/variants"
    ).json()
    assert {row["id"] for row in siblings} == {row["id"] for row in rows}


def test_an_ungrouped_artifact_is_its_own_only_variant(client_admin, ready):
    client_admin.post(f"/api/v1/copy/{ready['copy_id']}/approve")
    artifact_id = _create(client_admin, ready).json()[0]["id"]
    siblings = client_admin.get(f"/api/v1/artifacts/{artifact_id}/variants").json()
    assert [row["id"] for row in siblings] == [artifact_id]
