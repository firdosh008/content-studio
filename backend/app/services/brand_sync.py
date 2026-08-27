"""Materialise a brand's contracts and assets onto the shared volume.

open-design's documented way to add a design system is to drop a folder on
disk; there is no create/update endpoint (PRD 7.2). So the database stays the
source of truth and the filesystem is a rebuildable projection of it.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.contracts import latest_design, latest_voice
from app.core.config import settings
from app.db.models import AssetType, Brand, BrandAsset, BrandReference, Skill
from app.services import storage

logger = logging.getLogger(__name__)


def brand_root(slug: str) -> Path:
    # PRD 7.3: one directory per brand, so filesystem isolation is structural.
    return Path(settings.SHARED_VOLUME_ROOT) / "design-systems" / slug


def fonts_dir(slug: str) -> Path:
    return brand_root(slug) / "fonts"


def _write_if_changed(path: Path, data: bytes) -> None:
    if path.exists() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def sync_brand(db: Session, brand: Brand) -> Path:
    root = brand_root(brand.slug)
    root.mkdir(parents=True, exist_ok=True)

    design = latest_design(db, brand.id)
    _write_if_changed(
        root / "DESIGN.md", (design.design_md_content if design else "").encode()
    )

    voice = latest_voice(db, brand.id)
    _write_if_changed(
        root / "VOICE.md", (voice.voice_md_content if voice else "").encode()
    )

    assets = db.scalars(
        select(BrandAsset).where(BrandAsset.brand_id == brand.id)
    ).all()
    for asset in assets:
        filename = asset.file_ref.rsplit("/", 1)[-1]
        # PRD 4.4: fonts are self-hosted in the container, never host-resolved.
        target = (
            fonts_dir(brand.slug)
            if asset.asset_type == AssetType.FONT
            else root / "assets"
        )
        _write_if_changed(target / filename, storage.get(asset.file_ref))

    for ref in db.scalars(
        select(BrandReference).where(BrandReference.brand_id == brand.id)
    ).all():
        if ref.file_type == "image":
            filename = ref.file_ref.rsplit("/", 1)[-1]
            _write_if_changed(
                root / "references" / filename, storage.get(ref.file_ref)
            )

    if any(a.asset_type == AssetType.FONT for a in assets):
        _register_fonts(brand.slug)
    return root


def sync_skills(db: Session) -> None:
    """Skills are org-wide rather than per-brand, so they sync separately."""
    for skill in db.scalars(select(Skill).where(Skill.enabled.is_(True))).all():
        target = (
            Path(settings.SHARED_VOLUME_ROOT) / "skills" / skill.name / "SKILL.md"
        )
        _write_if_changed(target, storage.get(skill.storage_ref))


def _register_fonts(slug: str) -> None:
    """Point fontconfig at the brand's font directory.

    ponytail: writes a per-brand fonts.conf and refreshes the cache. If the
    open-design image ever ships its own fontconfig setup, delete this and use
    theirs instead of maintaining two.
    """
    conf = brand_root(slug) / "fonts.conf"
    conf.write_text(
        '<?xml version="1.0"?><fontconfig>'
        f"<dir>{fonts_dir(slug)}</dir>"
        "</fontconfig>"
    )
    try:
        subprocess.run(["fc-cache", "-f", str(fonts_dir(slug))], check=False)
    except FileNotFoundError:
        # fc-cache is absent on a dev mac; the container has it.
        logger.debug("fc-cache not installed; skipping font cache refresh")
