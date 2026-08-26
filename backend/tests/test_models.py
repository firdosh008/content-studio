import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models import ArtifactType, Base, Brand, Organization, Skill


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_brand_belongs_to_organization(db):
    org = Organization(name="Ladder")
    db.add(org)
    db.flush()
    db.add(Brand(organization_id=org.id, name="Agent Loopr", slug="agent-loopr"))
    db.commit()
    brand = db.scalar(select(Brand))
    assert brand.organization_id == org.id


def test_skill_cannot_apply_to_image(db):
    org = Organization(name="Ladder")
    db.add(org)
    db.flush()
    with pytest.raises(ValueError, match="image"):
        Skill(
            organization_id=org.id,
            name="hallmark",
            storage_ref="s/1",
            applies_to=[ArtifactType.IMAGE],
        )
