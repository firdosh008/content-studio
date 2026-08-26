"""DESIGN.md and VOICE.md - the two written brand contracts.

One row per brand, version bumped in place. Full history is not a v1
requirement and a second table would be speculative.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user, require_admin
from app.db.models import BrandVoice, DesignSystem, User
from app.db.session import get_db
from app.schemas.contract import ContractIn, ContractOut

router = APIRouter(prefix="/brands/{brand_id}", tags=["contracts"])


def latest_design(db: Session, brand_id: str) -> DesignSystem | None:
    return db.scalar(select(DesignSystem).where(DesignSystem.brand_id == brand_id))


def latest_voice(db: Session, brand_id: str) -> BrandVoice | None:
    return db.scalar(select(BrandVoice).where(BrandVoice.brand_id == brand_id))


def _read(row, field: str) -> ContractOut:
    if row is None:
        return ContractOut(content="", version=0)
    return ContractOut(
        content=getattr(row, field), version=row.version, updated_at=row.updated_at
    )


def _write(
    db: Session, row, model, field: str, brand_id: str, content: str
) -> ContractOut:
    if row is None:
        row = model(brand_id=brand_id, version=1, **{field: content})
        db.add(row)
    else:
        setattr(row, field, content)
        row.version += 1
    db.commit()
    db.refresh(row)
    return ContractOut(
        content=getattr(row, field), version=row.version, updated_at=row.updated_at
    )


@router.get("/design", response_model=ContractOut)
def read_design(
    brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    get_brand(db, brand_id)
    return _read(latest_design(db, brand_id), "design_md_content")


@router.put("/design", response_model=ContractOut)
def write_design(
    brand_id: str,
    payload: ContractIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    get_brand(db, brand_id)
    return _write(
        db,
        latest_design(db, brand_id),
        DesignSystem,
        "design_md_content",
        brand_id,
        payload.content,
    )


@router.get("/voice", response_model=ContractOut)
def read_voice(
    brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    get_brand(db, brand_id)
    return _read(latest_voice(db, brand_id), "voice_md_content")


@router.put("/voice", response_model=ContractOut)
def write_voice(
    brand_id: str,
    payload: ContractIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    get_brand(db, brand_id)
    return _write(
        db,
        latest_voice(db, brand_id),
        BrandVoice,
        "voice_md_content",
        brand_id,
        payload.content,
    )
