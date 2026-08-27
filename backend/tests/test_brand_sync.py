from app.db.models import AssetType, Brand, BrandAsset, DesignSystem
from app.services import brand_sync, storage


def _brand(db_session) -> Brand:
    from app.core.security import LADDER_ORG_ID

    brand = Brand(organization_id=LADDER_ORG_ID, name="Ladder", slug="ladder")
    db_session.add(brand)
    db_session.flush()
    return brand


def test_sync_writes_design_md(db_session, tmp_shared_volume):
    brand = _brand(db_session)
    db_session.add(
        DesignSystem(brand_id=brand.id, design_md_content="# Ladder", version=1)
    )
    db_session.commit()

    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "DESIGN.md").read_text() == "# Ladder"


def test_sync_writes_an_empty_voice_md_when_unwritten(db_session, tmp_shared_volume):
    brand = _brand(db_session)
    db_session.commit()
    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "VOICE.md").read_text() == ""


def test_fonts_land_in_a_fonts_dir(db_session, tmp_shared_volume, fake_storage):
    storage.put("ladder/assets/x-Inter.ttf", b"FONTBYTES", "font/ttf")
    brand = _brand(db_session)
    db_session.add(
        BrandAsset(
            brand_id=brand.id,
            asset_type=AssetType.FONT,
            file_ref="ladder/assets/x-Inter.ttf",
            label="Inter",
        )
    )
    db_session.commit()

    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "fonts" / "x-Inter.ttf").read_bytes() == b"FONTBYTES"


def test_non_font_assets_land_in_an_assets_dir(
    db_session, tmp_shared_volume, fake_storage
):
    storage.put("ladder/assets/y-logo.svg", b"<svg/>", "image/svg+xml")
    brand = _brand(db_session)
    db_session.add(
        BrandAsset(
            brand_id=brand.id,
            asset_type=AssetType.LOGO,
            file_ref="ladder/assets/y-logo.svg",
            label="Primary",
        )
    )
    db_session.commit()

    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "assets" / "y-logo.svg").read_bytes() == b"<svg/>"


def test_sync_is_idempotent(db_session, tmp_shared_volume):
    brand = _brand(db_session)
    db_session.add(
        DesignSystem(brand_id=brand.id, design_md_content="# v1", version=1)
    )
    db_session.commit()
    brand_sync.sync_brand(db_session, brand)
    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "DESIGN.md").read_text() == "# v1"


def test_each_brand_gets_its_own_directory(db_session, tmp_shared_volume):
    assert brand_sync.brand_root("ladder") != brand_sync.brand_root("agent-loopr")
    assert brand_sync.brand_root("ladder").parent.name == "design-systems"
