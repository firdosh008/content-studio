import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import LADDER_ORG_ID, current_user, require_admin
from app.db.models import Brand, User
from app.db.session import get_db
from app.schemas.brand import BrandCreate, BrandOut

router = APIRouter(prefix="/brands", tags=["brands"])


def slugify(name: str) -> str:
    """The slug is not cosmetic - it becomes the on-disk folder name under
    design-systems/, so it is constrained to a safe character set."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not slug:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "name has no usable characters",
        )
    return slug[:80]


def get_brand(db: Session, brand_id: str) -> Brand:
    brand = db.get(Brand, brand_id)
    if brand is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "brand not found")
    return brand


@router.get("", response_model=list[BrandOut])
def list_brands(db: Session = Depends(get_db), _: User = Depends(current_user)):
    # PRD 2: no per-brand permission UI in v1 - every member sees every brand.
    return db.scalars(select(Brand).order_by(Brand.name)).all()


@router.post("", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
def create_brand(
    payload: BrandCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    slug = slugify(payload.name)
    if db.scalar(select(Brand).where(Brand.slug == slug)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"brand slug '{slug}' already exists"
        )
    brand = Brand(
        organization_id=LADDER_ORG_ID,
        name=payload.name,
        slug=slug,
        created_by=admin.id,
    )
    db.add(brand)
    db.commit()
    db.refresh(brand)
    return brand


@router.get("/{brand_id}", response_model=BrandOut)
def read_brand(
    brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)
):
    return get_brand(db, brand_id)
