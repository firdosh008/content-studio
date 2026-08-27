import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.api.v1.briefs import get_brief
from app.api.v1.copy import get_approved_copy
from app.core.security import current_user
from app.db.models import (
    Artifact,
    ArtifactStatus,
    ArtifactType,
    GenerationMode,
    ModelProvider,
    ProviderType,
    User,
)
from app.db.session import get_db
from app.schemas.artifact import ArtifactCreate, ArtifactOut, IterateRequest
from app.workers import queue

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

MAX_LINEAGE_DEPTH = 100


def mode_for(artifact_type: ArtifactType) -> GenerationMode:
    """PRD 2: only `image` runs image-mode; everything else is code-mode."""
    return (
        GenerationMode.IMAGE
        if artifact_type == ArtifactType.IMAGE
        else GenerationMode.CODE
    )


def get_artifact(db: Session, artifact_id: str) -> Artifact:
    artifact = db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    return artifact


@router.post(
    "", response_model=list[ArtifactOut], status_code=status.HTTP_201_CREATED
)
def create_artifacts(
    payload: ArtifactCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    get_brand(db, payload.brand_id)
    get_brief(db, payload.brief_id)
    try:
        artifact_type = ArtifactType(payload.artifact_type)
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"unknown artifact_type: {payload.artifact_type}",
        ) from None
    mode = mode_for(artifact_type)

    provider = db.get(ModelProvider, payload.model_provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "model not available"
        )
    wanted = (
        ProviderType.IMAGE_PROVIDER
        if mode == GenerationMode.IMAGE
        else ProviderType.CODING_AGENT
    )
    if provider.type != wanted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{artifact_type.value} needs a {wanted.value}",
        )

    if payload.copy_id:
        get_approved_copy(db, payload.copy_id)  # 409 unless approved

    # PRD 5.3: N options from one brief is the real workflow, not an edge case.
    group_id = str(uuid.uuid4()) if payload.variants > 1 else None
    rows = []
    for _ in range(payload.variants):
        artifact = Artifact(
            brand_id=payload.brand_id,
            brief_id=payload.brief_id,
            copy_id=payload.copy_id,
            artifact_type=artifact_type,
            generation_mode=mode,
            model_provider_id=provider.id,
            status=ArtifactStatus.QUEUED,
            version=1,
            variant_group_id=group_id,
            created_by=user.id,
        )
        db.add(artifact)
        rows.append(artifact)
    db.commit()
    for artifact in rows:
        db.refresh(artifact)
        queue.enqueue(db, artifact.id)
    return rows


@router.get("", response_model=list[ArtifactOut])
def list_artifacts(
    brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    return db.scalars(
        select(Artifact)
        .where(Artifact.brand_id == brand_id)
        .order_by(Artifact.created_at.desc(), Artifact.id.desc())
    ).all()


@router.get("/{artifact_id}", response_model=ArtifactOut)
def read_artifact(
    artifact_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    return get_artifact(db, artifact_id)


@router.post(
    "/{artifact_id}/iterate",
    response_model=ArtifactOut,
    status_code=status.HTTP_201_CREATED,
)
def iterate(
    artifact_id: str,
    payload: IterateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """PRD 5.4: every iteration creates a new version; lineage is preserved."""
    parent = get_artifact(db, artifact_id)
    if not parent.open_design_project_ref:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "cannot iterate on an artifact that never generated",
        )
    child = Artifact(
        brand_id=parent.brand_id,
        brief_id=parent.brief_id,
        copy_id=parent.copy_id,
        artifact_type=parent.artifact_type,
        generation_mode=parent.generation_mode,
        model_provider_id=parent.model_provider_id,
        status=ArtifactStatus.QUEUED,
        version=parent.version + 1,
        parent_artifact_id=parent.id,
        variant_group_id=parent.variant_group_id,
        open_design_project_ref=parent.open_design_project_ref,
        edit_instruction=payload.instruction,
        created_by=user.id,
    )
    db.add(child)
    db.commit()
    db.refresh(child)
    queue.enqueue(db, child.id)
    return child


@router.get("/{artifact_id}/lineage", response_model=list[ArtifactOut])
def lineage(
    artifact_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    """PRD 5.4: every iteration creates a new version; lineage is preserved."""
    chain: list[Artifact] = []
    seen: set[str] = set()
    node = get_artifact(db, artifact_id)
    while node is not None and node.id not in seen and len(chain) < MAX_LINEAGE_DEPTH:
        chain.append(node)
        seen.add(node.id)
        node = (
            db.get(Artifact, node.parent_artifact_id)
            if node.parent_artifact_id
            else None
        )
    return list(reversed(chain))


@router.get("/{artifact_id}/variants", response_model=list[ArtifactOut])
def variants(
    artifact_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    """PRD 5.3: one brief producing N options is the real workflow."""
    artifact = get_artifact(db, artifact_id)
    if not artifact.variant_group_id:
        return [artifact]
    return db.scalars(
        select(Artifact)
        .where(Artifact.variant_group_id == artifact.variant_group_id)
        .order_by(Artifact.created_at, Artifact.id)
    ).all()
