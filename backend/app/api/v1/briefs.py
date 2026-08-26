from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user
from app.db.models import Brief, User
from app.db.session import get_db
from app.schemas.brief import BriefCreate, BriefOut

router = APIRouter(prefix="/briefs", tags=["briefs"])


def get_brief(db: Session, brief_id: str) -> Brief:
    brief = db.get(Brief, brief_id)
    if brief is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "brief not found")
    return brief


@router.post("", response_model=BriefOut, status_code=status.HTTP_201_CREATED)
def create_brief(
    payload: BriefCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    get_brand(db, payload.brand_id)
    brief = Brief(
        brand_id=payload.brand_id,
        created_by=user.id,
        source=payload.source,
        content=payload.content,
        research_run_id=payload.research_run_id,
    )
    db.add(brief)
    db.commit()
    db.refresh(brief)
    return brief


@router.get("", response_model=list[BriefOut])
def list_briefs(
    brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    return db.scalars(
        select(Brief)
        .where(Brief.brand_id == brand_id)
        .order_by(Brief.created_at.desc(), Brief.id.desc())
    ).all()


@router.get("/{brief_id}", response_model=BriefOut)
def read_brief(
    brief_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    return get_brief(db, brief_id)
