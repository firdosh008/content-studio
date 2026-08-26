import io
import zipfile

import pytest

from app.db.models import ArtifactStatus, ArtifactType


@pytest.fixture
def stub_download(monkeypatch):
    from app.services import open_design as od

    monkeypatch.setattr(od, "download_export", lambda url: f"bytes:{url}".encode())


@pytest.fixture
def ready_artifact(db_session, factory):
    artifact = factory.artifact(status=ArtifactStatus.READY)
    artifact.export_urls = {"png": "http://od/e/1.png"}
    db_session.commit()
    return artifact


def test_exports_are_signed_not_raw_daemon_urls(
    client_admin, ready_artifact, fake_storage, stub_download
):
    body = client_admin.get(
        f"/api/v1/artifacts/{ready_artifact.id}/exports"
    ).json()
    assert "od/e/" not in body["png"]
    assert body["png"].startswith("https://")


def test_an_unready_artifact_has_no_exports(client_admin, factory):
    artifact = factory.artifact(status=ArtifactStatus.QUEUED)
    response = client_admin.get(f"/api/v1/artifacts/{artifact.id}/exports")
    assert response.status_code == 409


def test_formats_outside_the_scope_table_are_dropped(
    client_admin, db_session, factory, fake_storage, stub_download
):
    artifact = factory.artifact(status=ArtifactStatus.READY)
    artifact.export_urls = {"png": "http://od/1.png", "pptx": "http://od/1.pptx"}
    db_session.commit()
    body = client_admin.get(f"/api/v1/artifacts/{artifact.id}/exports").json()
    # A carousel exports PNG only. PRD 2.
    assert set(body) == {"png"}


def test_a_deck_exports_pptx_and_pdf(
    client_admin, db_session, factory, fake_storage, stub_download
):
    artifact = factory.artifact(
        artifact_type=ArtifactType.DECK, status=ArtifactStatus.READY
    )
    artifact.export_urls = {
        "pptx": "http://od/1.pptx",
        "pdf": "http://od/1.pdf",
        "png": "http://od/1.png",
    }
    db_session.commit()
    body = client_admin.get(f"/api/v1/artifacts/{artifact.id}/exports").json()
    assert set(body) == {"pptx", "pdf"}


def test_a_deck_rejects_the_png_zip(client_admin, db_session, factory):
    artifact = factory.artifact(
        artifact_type=ArtifactType.DECK, status=ArtifactStatus.READY
    )
    artifact.export_urls = {"pptx": "http://od/1.pptx"}
    db_session.commit()
    response = client_admin.get(f"/api/v1/artifacts/{artifact.id}/exports/png.zip")
    assert response.status_code == 422


def test_a_carousel_zip_contains_one_png_per_card(
    client_admin, db_session, factory, stub_download
):
    artifact = factory.artifact(status=ArtifactStatus.READY)
    artifact.export_urls = {
        "png": "http://od/1.png",
        "cards": ["http://od/c1.png", "http://od/c2.png", "http://od/c3.png"],
    }
    db_session.commit()
    response = client_admin.get(f"/api/v1/artifacts/{artifact.id}/exports/png.zip")
    names = zipfile.ZipFile(io.BytesIO(response.content)).namelist()
    assert names == ["card-01.png", "card-02.png", "card-03.png"]


def test_a_carousel_with_no_cards_cannot_zip(
    client_admin, db_session, factory
):
    artifact = factory.artifact(status=ArtifactStatus.READY)
    artifact.export_urls = {"png": "http://od/1.png"}
    db_session.commit()
    assert client_admin.get(
        f"/api/v1/artifacts/{artifact.id}/exports/png.zip"
    ).status_code == 409


def test_a_final_export_requires_approval(
    client_admin, ready_artifact, fake_storage, stub_download
):
    response = client_admin.get(
        f"/api/v1/artifacts/{ready_artifact.id}/exports?final=true"
    )
    assert response.status_code == 409
    assert "approved" in response.json()["detail"]


def test_an_approved_artifact_allows_a_final_export(
    client_admin, db_session, ready_artifact, fake_storage, stub_download
):
    ready_artifact.status = ArtifactStatus.APPROVED
    db_session.commit()
    assert client_admin.get(
        f"/api/v1/artifacts/{ready_artifact.id}/exports?final=true"
    ).status_code == 200
