"""Seed the single organization. PRD 8: v1 has exactly one row.

Revision ID: seed_ladder_org
Revises: de45e3154a16
"""

from alembic import op

revision = "seed_ladder_org"
down_revision = "de45e3154a16"
branch_labels = None
depends_on = None

LADDER_ORG_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    op.execute(
        "INSERT INTO organizations (id, name, created_at) "
        f"VALUES ('{LADDER_ORG_ID}', 'Ladder', CURRENT_TIMESTAMP)"
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM organizations WHERE id = '{LADDER_ORG_ID}'")
