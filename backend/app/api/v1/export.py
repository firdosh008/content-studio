"""Exports.

Files are pulled from open-design once, cached into Storage, and served as
signed URLs. That keeps the daemon off the public internet and makes links
revocable: stop signing and the old URL expires on its own.
"""

import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.v1.artifacts import get_artifact
from app.core.security import current_user
from app.db.models import Artifact, ArtifactStatus, ArtifactType, Brand, User
from app.db.session import get_db
from app.services import open_design as od
from app.services import storage

router = APIRouter(prefix="/artifacts/{artifact_id}/exports", tags=["exports"])

# PRD 2 scope table. Nothing outside this map is exportable.
ALLOWED_FORMATS: dict[ArtifactType, tuple[str, ...]] = {
    ArtifactType.SOCIAL_POST: ("png",),
    ArtifactType.CAROUSEL: ("png",),
    ArtifactType.DECK: ("pptx", "pdf"),
    ArtifactType.SINGLE_PAGER: ("pdf", "html"),
    ArtifactType.IMAGE: ("png", "jpg"),
}

EXPORTABLE_STATUSES = {
    ArtifactStatus.READY,
    ArtifactStatus.IN_REVIEW,
    ArtifactStatus.APPROVED,
}


def _require_exportable(artifact: Artifact) -> None:
    if artifact.status not in EXPORTABLE_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"artifact is {artifact.status.value}, nothing to export",
        )


def _cache(db: Session, artifact: Artifact, fmt: str, url: str) -> str:
    brand = db.get(Brand, artifact.brand_id)
    key = storage.key_for(
        brand.slug, "exports", f"{artifact.id}-{artifact.version}.{fmt}"
    )
    storage.put(key, od.download_export(url), "application/octet-stream")
    return storage.signed_url(key)


@router.get("")
def list_exports(
    artifact_id: str,
    final: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> dict[str, str]:
    artifact = get_artifact(db, artifact_id)
    _require_exportable(artifact)
    # PRD 5.6: nothing is exportable-as-final until approved.
    if final and artifact.status != ArtifactStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "artifact must be approved for a final export",
        )
    allowed = ALLOWED_FORMATS[artifact.artifact_type]
    return {
        fmt: _cache(db, artifact, fmt, url)
        for fmt, url in (artifact.export_urls or {}).items()
        if fmt in allowed and isinstance(url, str)
    }


@router.get("/{fmt}.zip")
def zip_export(
    artifact_id: str,
    fmt: str,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> Response:
    """PRD 2: a carousel ships as one PNG per card in a ZIP."""
    artifact = get_artifact(db, artifact_id)
    _require_exportable(artifact)
    if artifact.artifact_type != ArtifactType.CAROUSEL or fmt != "png":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "zip export is carousel png only",
        )
    cards = (artifact.export_urls or {}).get("cards") or []
    if not cards:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "no card exports on this artifact"
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, url in enumerate(cards, start=1):
            archive.writestr(f"card-{index:02d}.png", od.download_export(url))
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="carousel-{artifact.id}.zip"'
            )
        },
    )
