from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.v1.briefs import get_brief
from app.api.v1.contracts import latest_voice
from app.core.security import current_user, require_admin
from app.db.models import Copy, CopyStatus, ModelProvider, User
from app.db.session import get_db
from app.schemas.copy import CopyCreate, CopyOut, CopyUpdate
from app.services import copy_gen

router = APIRouter(tags=["copy"])


def get_copy(db: Session, copy_id: str) -> Copy:
    row = db.get(Copy, copy_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "copy not found")
    return row


def get_approved_copy(db: Session, copy_id: str) -> Copy:
    """PRD 5.2: the design agent consumes approved copy; it does not write it."""
    row = get_copy(db, copy_id)
    if row.status != CopyStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "copy must be approved before design can start",
        )
    return row


@router.post(
    "/briefs/{brief_id}/copy",
    response_model=CopyOut,
    status_code=status.HTTP_201_CREATED,
)
def create_copy(
    brief_id: str,
    payload: CopyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    brief = get_brief(db, brief_id)
    model_id = None
    if payload.generate:
        provider = db.get(ModelProvider, payload.model_provider_id)
        if provider is None or not provider.enabled:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "model not available"
            )
        voice = latest_voice(db, brief.brand_id)
        try:
            content = copy_gen.generate_copy(
                brief.content,
                voice.voice_md_content if voice else "",
                payload.artifact_type,
                provider.name,
            )
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
            ) from exc
        model_id = provider.id
    else:
        # PRD 5.2: writing copy by hand is first-class, not a fallback.
        content = payload.content

    row = Copy(
        brief_id=brief.id,
        brand_id=brief.brand_id,
        content=content,
        status=CopyStatus.DRAFT,
        generated_by_model_id=model_id,
        version=1,
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/copy/{copy_id}", response_model=CopyOut)
def update_copy(
    copy_id: str,
    payload: CopyUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    row = get_copy(db, copy_id)
    row.content = payload.content
    row.version += 1
    # An edit invalidates the approval it was granted under.
    row.status = CopyStatus.DRAFT
    row.approved_by = None
    db.commit()
    db.refresh(row)
    return row


@router.post("/copy/{copy_id}/approve", response_model=CopyOut)
def approve_copy(
    copy_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = get_copy(db, copy_id)
    row.status = CopyStatus.APPROVED
    row.approved_by = admin.id
    db.commit()
    db.refresh(row)
    return row
