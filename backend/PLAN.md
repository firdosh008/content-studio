# Content Studio — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python/FastAPI service that owns brand governance, the copy stage, a durable generation queue, a mechanical QA gate, approval state and exports, driving a self-hosted open-design instance.

**Architecture:** FastAPI + SQLAlchemy + Alembic over Supabase Postgres. Supabase Auth for identity (JWT verified via JWKS, no local sessions). Supabase Storage is the source of truth for files; a sync service materialises them onto a Docker volume shared with the open-design container, because open-design reads design systems and assets off disk. Generation is async through a Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`) — no Redis, no Celery. open-design is reached through exactly one adapter module so it stays swappable.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, `supabase-py`, PyJWT, python-pptx, Playwright (Chromium), Pillow, poppler-utils (`pdftoppm`, `pdffonts`), LibreOffice headless, pytest, Docker Compose.

**Spec:** `../Content_Studio_PRD.md`

## Global Constraints

- Python 3.12. FastAPI. SQLAlchemy 2.0 declarative. Pydantic v2.
- One `Organization` row, seeded "Ladder". No UI or endpoint creates a second. (PRD §8)
- `Skill.applies_to` MUST reject `image`, enforced in code at write time, not by admin discipline. (PRD §6.4)
- open-design appears in the schema only as `open_design_project_ref` (opaque string) and `export_urls` (jsonb). No open-design concept may become a column, enum or model. (PRD §7.4)
- All open-design HTTP calls live in `app/services/open_design.py`. No other module imports `httpx` against the daemon.
- Brand fonts are self-hosted inside the open-design container. Never resolve fonts from the host OS. (PRD §4.4)
- Copy is approved before design starts. The design call MUST refuse a `Copy` row whose `status != approved`. (PRD §5.2)
- Structured documents (contracts, proposals, SOWs, reports) are out of scope permanently. No `artifact_type` may be added for them. (PRD §2)
- No publishing or scheduling endpoints. (PRD §2)
- Every generation creates a new `Artifact` row with `parent_artifact_id` set. Rows are never mutated in place for content changes. (PRD §5.4)
- `artifact_type` enum is exactly: `social_post | carousel | deck | single_pager | image`.
- `generation_mode` is exactly: `code | image`.
- All timestamps are timezone-aware UTC.
- Every task ends with a commit.

---

## File Structure

```
backend/
  app/
    main.py                     FastAPI app, router mounting, lifespan
    core/
      config.py                 pydantic-settings, all env
      security.py               Supabase JWT verify, role guards
      errors.py                 typed HTTP exceptions
    db/
      session.py                engine, session factory, get_db dep
      models.py                 every table in PRD §8
    schemas/                    pydantic request/response, one file per resource
    api/v1/
      router.py                 aggregates all routers
      brands.py  contracts.py  references.py  assets.py
      briefs.py  copy.py  artifacts.py  jobs.py
      providers.py  skills.py  users.py  export.py
    services/
      storage.py                Supabase Storage put/get/sign
      brand_sync.py             DB+Storage -> shared volume
      pptx_extract.py           python-pptx -> text layout spec
      open_design.py            THE ONLY open-design adapter
      copy_gen.py               VOICE.md + ai_tells -> copy draft
      research_client.py        ResearchInput/ResearchResult port
      qa/
        pipeline.py             orchestrates the §6.1 loop
        rasterize.py            pdf -> jpegs, pptx -> pdf
        dom_probe.py            Playwright geometry probe
        checks/
          overflow.py  bounds.py  fill.py  tokens.py
          palette.py   fonts.py   determinism.py
        fixtures.py             §6.3 fixture matrix runner
    workers/
      queue.py                  claim/complete/fail on generation_jobs
      generation_worker.py      the worker loop process
    prompts/
      ai_tells.py               ported verbatim from LadderFlow
      copy_prompt.py
  alembic/
  tests/
  Dockerfile
  docker-compose.yml
  requirements.txt
```

Splitting rule used above: files that change together live together. `qa/checks/*` are one file per check because each has its own test and its own failure mode; a reviewer can reject the palette check while approving the fill check.

---

## Phase 0 — Validate before building

### Task 0: Prove open-design produces usable output

No product code. If this fails, the rest of the plan is void. (PRD §11)

**Files:**
- Create: `docs/phase0-findings.md`
- Create: `docs/brands/ladder/DESIGN.md`
- Create: `docs/brands/ladder/VOICE.md`

- [ ] **Step 1: Stand up open-design**

```bash
git clone https://github.com/nexu-io/open-design /opt/open-design
cd /opt/open-design && docker compose up -d
curl -s localhost:PORT/api/health
```

Record the real port, the daemon base URL, and the exact health path in `docs/phase0-findings.md`.

- [ ] **Step 2: Write one real DESIGN.md and one real VOICE.md for Ladder**

Hand-authored, not generated. DESIGN.md covers palette hex values, type scale, spacing rhythm, component conventions, layout principles. VOICE.md covers what the brand sounds like, what it never says, claim-substantiation rules, banned AI-tell patterns.

- [ ] **Step 3: Drop the design system on disk and generate 5 carousels + 1 deck**

```bash
mkdir -p /opt/open-design/design-systems/ladder
cp docs/brands/ladder/DESIGN.md /opt/open-design/design-systems/ladder/
```

Generate against 6 real briefs. Save every output under `docs/phase0-output/`.

- [ ] **Step 4: Answer OQ1 — PPTX export fidelity**

Open the generated `.pptx` in PowerPoint. Try to edit a text block and move a shape. Record in findings: `ooxml_native` or `html_converted`. If `html_converted`, write a paragraph on whether `deck` stays in v1 scope.

- [ ] **Step 5: Answer OQ2 — image-mode references**

```bash
# from the open-design CLI, per its docs
open-design image --image ref1.png --image ref2.png --prompt "..." --json
```

Record whether multiple `--image` refs work and whether `gpt-image-*` still errors on `response_format`.

- [ ] **Step 6: Answer OQ3 — Figma import**

Feed the existing Ladder Figma file to open-design's design-system import. Record whether the produced DESIGN.md beats the hand-authored one. If it does, Task 5 gains an import path later.

- [ ] **Step 7: Answer OQ4 and OQ5**

OQ4: try Kimi via OpenAI-compatible `baseUrl` + key with no host install. Record yes/no.
OQ5: attach a layout screenshot to a generation and confirm from the agent's response that it actually saw the image. Record per agent tried.

- [ ] **Step 8: Write the go/no-go**

`docs/phase0-findings.md` ends with an explicit line: `GO` or `NO-GO`, plus the daemon base URL, the generation endpoint path, the chat/edit endpoint path, and the export URL shape. Tasks 8 and 12 read these values.

- [ ] **Step 9: Commit**

```bash
git add docs/
git commit -m "docs: phase 0 open-design validation findings"
```

---

## Phase 1 — Core loop

### Task 1: Service skeleton, config, health, Docker

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/main.py`
- Create: `backend/app/core/config.py`
- Create: `backend/Dockerfile`
- Create: `backend/docker-compose.yml`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.core.config.settings` (a `Settings` instance); `app.main.app` (FastAPI instance).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_health.py
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 3: Write requirements.txt**

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
sqlalchemy==2.0.*
alembic==1.14.*
psycopg[binary]==3.2.*
pydantic==2.9.*
pydantic-settings==2.6.*
pyjwt[crypto]==2.9.*
httpx==0.27.*
python-pptx==1.0.*
pillow==11.0.*
supabase==2.9.*
playwright==1.48.*
python-multipart==0.0.*
pytest==8.3.*
pytest-asyncio==0.24.*
```

- [ ] **Step 4: Write config**

```python
# backend/app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_JWT_AUD: str = "authenticated"
    STORAGE_BUCKET: str = "content-studio"

    # Shared volume the open-design container also mounts. PRD 7.2.
    SHARED_VOLUME_ROOT: str = "/data/open-design"
    OPEN_DESIGN_BASE_URL: str = "http://open-design:3000"
    OPEN_DESIGN_TIMEOUT_SECONDS: int = 900

    # PRD 7.1: a single daemon serialises. Raise only with more daemons.
    MAX_CONCURRENT_GENERATIONS: int = 1

    QA_RASTER_DPI: int = 100
    QA_MIN_FILL_RATIO: float = 0.35
    QA_PALETTE_TOLERANCE: int = 12

settings = Settings()
```

- [ ] **Step 5: Write main.py**

```python
# backend/app/main.py
from fastapi import FastAPI

app = FastAPI(title="Content Studio API", version="0.1.0")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 7: Write the Dockerfile**

System packages matter here — QA needs LibreOffice and poppler, and Playwright needs Chromium.

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-impress poppler-utils fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install --with-deps chromium

COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 8: Write docker-compose.yml**

The shared volume is the whole point of this file.

```yaml
services:
  api:
    build: .
    env_file: .env
    ports: ["8000:8000"]
    volumes:
      - open-design-data:/data/open-design
    depends_on: [open-design]

  worker:
    build: .
    env_file: .env
    command: python -m app.workers.generation_worker
    volumes:
      - open-design-data:/data/open-design
    depends_on: [open-design]

  open-design:
    image: ghcr.io/nexu-io/open-design:latest
    env_file: .env.open-design
    volumes:
      - open-design-data:/app/data

volumes:
  open-design-data:
```

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat: backend skeleton with health check and docker compose"
```

### Task 2: Database models and first migration

Every table in PRD §8, no more.

**Files:**
- Create: `backend/app/db/session.py`
- Create: `backend/app/db/models.py`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `Base`, and the ORM classes `Organization, User, Brand, DesignSystem, BrandVoice, BrandReference, BrandAsset, BrandAccess, ModelProvider, Skill, Brief, Copy, Artifact, GenerationJob`. Also `get_db()` FastAPI dependency yielding a `Session`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_models.py
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.db.models import Base, Organization, Brand, Skill, ArtifactType

@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s

def test_brand_belongs_to_organization(db):
    org = Organization(name="Ladder")
    db.add(org); db.flush()
    db.add(Brand(organization_id=org.id, name="Agent Loopr"))
    db.commit()
    brand = db.scalar(select(Brand))
    assert brand.organization_id == org.id

def test_skill_cannot_apply_to_image(db):
    org = Organization(name="Ladder")
    db.add(org); db.flush()
    with pytest.raises(ValueError, match="image"):
        Skill(organization_id=org.id, name="hallmark",
              storage_ref="s/1", applies_to=[ArtifactType.IMAGE])
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db.models'`

- [ ] **Step 3: Write the enums and the base**

```python
# backend/app/db/models.py
from __future__ import annotations
import uuid
from datetime import datetime, UTC
from enum import StrEnum

from sqlalchemy import ForeignKey, String, Text, Boolean, Integer, JSON, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, validates

def _uuid() -> str:
    return str(uuid.uuid4())

def _now() -> datetime:
    return datetime.now(UTC)

class Base(DeclarativeBase):
    pass

class Role(StrEnum):
    ADMIN = "admin"
    MEMBER = "member"

class ArtifactType(StrEnum):
    SOCIAL_POST = "social_post"
    CAROUSEL = "carousel"
    DECK = "deck"
    SINGLE_PAGER = "single_pager"
    IMAGE = "image"

class GenerationMode(StrEnum):
    CODE = "code"
    IMAGE = "image"

class ArtifactStatus(StrEnum):
    QUEUED = "queued"
    GENERATING = "generating"
    READY = "ready"
    QA_FAILED = "qa_failed"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    FAILED = "failed"

class JobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

class CopyStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"

class ReferenceScope(StrEnum):
    SOCIAL = "social"
    PRESENTATION = "presentation"
    BOTH = "both"

class ReferenceRole(StrEnum):
    LAYOUT = "layout"
    TYPOGRAPHY = "typography"
    COLOUR_GRADIENT = "colour_gradient"
    OVERALL_VIBE = "overall_vibe"

class AssetType(StrEnum):
    LOGO = "logo"
    FONT = "font"
    HEADSHOT = "headshot"
    SCREENSHOT = "screenshot"
    ICON = "icon"

class ProviderType(StrEnum):
    CODING_AGENT = "coding_agent"
    IMAGE_PROVIDER = "image_provider"
```

- [ ] **Step 4: Write the tables**

```python
class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    auth_ref: Mapped[str] = mapped_column(String(128), unique=True)  # Supabase sub
    role: Mapped[Role] = mapped_column(String(16), default=Role.MEMBER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class Brand(Base):
    __tablename__ = "brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)  # folder name on disk
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class DesignSystem(Base):
    __tablename__ = "design_systems"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    design_md_content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

class BrandVoice(Base):
    __tablename__ = "brand_voices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    voice_md_content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

class BrandReference(Base):
    __tablename__ = "brand_references"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    file_ref: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(16))  # image | pptx
    scope: Mapped[ReferenceScope] = mapped_column(String(16))
    role: Mapped[ReferenceRole] = mapped_column(String(24))
    extracted_layout_spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class BrandAsset(Base):
    __tablename__ = "brand_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    asset_type: Mapped[AssetType] = mapped_column(String(24))
    file_ref: Mapped[str] = mapped_column(String(500))
    label: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class BrandAccess(Base):
    """Schema only. No UI in v1 — every member gets every brand. PRD 2."""
    __tablename__ = "brand_access"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))

class ModelProvider(Base):
    __tablename__ = "model_providers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    type: Mapped[ProviderType] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(120))
    credential_ref: Mapped[str] = mapped_column(String(500))  # never the raw key
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class Skill(Base):
    __tablename__ = "skills"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(120))
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    storage_ref: Mapped[str] = mapped_column(String(500))
    applies_to: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    @validates("applies_to")
    def _forbid_image(self, _key: str, value: list[str]) -> list[str]:
        """PRD 6.4: Hallmark needs a coding agent; image-mode has none.
        Enforced here so admin discipline is not the control."""
        items = [str(v) for v in (value or [])]
        if ArtifactType.IMAGE.value in items:
            raise ValueError("applies_to may not contain 'image'")
        unknown = set(items) - {t.value for t in ArtifactType}
        if unknown:
            raise ValueError(f"unknown artifact types: {sorted(unknown)}")
        return items

class Brief(Base):
    __tablename__ = "briefs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    source: Mapped[str] = mapped_column(String(24), default="manual")  # manual|research_agent
    content: Mapped[str] = mapped_column(Text)
    research_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class Copy(Base):
    __tablename__ = "copies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brief_id: Mapped[str] = mapped_column(ForeignKey("briefs.id"))
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[CopyStatus] = mapped_column(String(16), default=CopyStatus.DRAFT)
    generated_by_model_id: Mapped[str | None] = mapped_column(ForeignKey("model_providers.id"), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    brief_id: Mapped[str] = mapped_column(ForeignKey("briefs.id"))
    copy_id: Mapped[str | None] = mapped_column(ForeignKey("copies.id"), nullable=True)
    artifact_type: Mapped[ArtifactType] = mapped_column(String(24))
    generation_mode: Mapped[GenerationMode] = mapped_column(String(16))
    model_provider_id: Mapped[str] = mapped_column(ForeignKey("model_providers.id"))
    status: Mapped[ArtifactStatus] = mapped_column(String(24), default=ArtifactStatus.QUEUED)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifacts.id"), nullable=True)
    variant_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    open_design_project_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    export_urls: Mapped[dict] = mapped_column(JSON, default=dict)
    qa_report: Mapped[dict] = mapped_column(JSON, default=dict)
    edit_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

class GenerationJob(Base):
    __tablename__ = "generation_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    state: Mapped[JobState] = mapped_column(String(16), default=JobState.QUEUED)
    progress_ref: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 5: Write the session module**

```python
# backend/app/db/session.py
from collections.abc import Iterator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `pytest tests/test_models.py -v`
Expected: 2 passed

- [ ] **Step 7: Generate and apply the migration**

```bash
alembic init alembic
# set target_metadata = Base.metadata in alembic/env.py
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

- [ ] **Step 8: Seed the single organization**

```python
# backend/alembic/versions/<rev>_seed_org.py  (a second, hand-written revision)
def upgrade() -> None:
    op.execute(
        "INSERT INTO organizations (id, name, created_at) "
        "VALUES ('00000000-0000-0000-0000-000000000001', 'Ladder', now())"
    )
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/db backend/alembic backend/alembic.ini backend/tests/test_models.py
git commit -m "feat: PRD section 8 schema with image-skill guard and seeded org"
```

### Task 3: Supabase JWT auth and role guards

**Files:**
- Create: `backend/app/core/security.py`
- Create: `backend/app/api/v1/users.py`
- Create: `backend/app/api/v1/router.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `User`, `Role`, `get_db` from Task 2.
- Produces: `current_user(...) -> User` FastAPI dependency; `require_admin(...) -> User` dependency; endpoint `GET /api/v1/me`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_auth.py
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import current_user
from app.db.models import User, Role

def _fake_user(role=Role.MEMBER):
    return User(id="u1", organization_id="o1", email="a@b.com",
                auth_ref="sub-1", role=role)

def test_me_requires_a_token():
    with TestClient(app) as client:
        assert client.get("/api/v1/me").status_code == 403

def test_me_returns_the_caller():
    app.dependency_overrides[current_user] = lambda: _fake_user()
    with TestClient(app) as client:
        body = client.get("/api/v1/me").json()
    app.dependency_overrides.clear()
    assert body["email"] == "a@b.com"
    assert body["role"] == "member"

def test_admin_only_route_rejects_a_member():
    from app.core.security import require_admin
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        require_admin(user=_fake_user(Role.MEMBER))
    assert exc.value.status_code == 403
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.security'`

- [ ] **Step 3: Write security.py**

Supabase signs with RS256 and publishes JWKS. Verifying against JWKS means no shared secret in our env and key rotation costs nothing.

```python
# backend/app/core/security.py
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.db.models import User, Role

LADDER_ORG_ID = "00000000-0000-0000-0000-000000000001"

_bearer = HTTPBearer()
_jwks = PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json")

def _decode(token: str) -> dict:
    try:
        key = _jwks.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token, key, algorithms=["RS256", "ES256"],
            audience=settings.SUPABASE_JWT_AUD,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc

def current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Verify the Supabase token and upsert the local User row.

    Rows are created on first sight rather than by an invite flow: v1 is a
    single shared workspace, so anyone Supabase authenticates is a member.
    """
    claims = _decode(creds.credentials)
    sub, email = claims.get("sub"), claims.get("email")
    if not sub or not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token missing sub or email")

    user = db.scalar(select(User).where(User.auth_ref == sub))
    if user is None:
        user = User(organization_id=LADDER_ORG_ID, email=email,
                    auth_ref=sub, role=Role.MEMBER)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user
```

- [ ] **Step 4: Write the /me route and the router**

```python
# backend/app/api/v1/users.py
from fastapi import APIRouter, Depends
from app.core.security import current_user
from app.db.models import User

router = APIRouter(tags=["users"])

@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}
```

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1 import users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(users.router)
```

Mount it in `app/main.py`:

```python
from app.api.v1.router import api_router
app.include_router(api_router)
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_auth.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/security.py backend/app/api backend/app/main.py backend/tests/test_auth.py
git commit -m "feat: supabase jwt auth with member upsert and admin guard"
```

### Task 4: Brands CRUD

**Files:**
- Create: `backend/app/schemas/brand.py`
- Create: `backend/app/api/v1/brands.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_brands.py`

**Interfaces:**
- Consumes: `current_user`, `require_admin`, `get_db`, `Brand`.
- Produces: `GET /api/v1/brands`, `POST /api/v1/brands` (admin), `GET /api/v1/brands/{brand_id}`. Response shape `{id, name, slug, created_at}`. Also `app.api.v1.brands.get_brand(db, brand_id) -> Brand` used by later tasks.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_brands.py
from app.db.models import Role

def test_member_cannot_create_a_brand(client_member):
    r = client_member.post("/api/v1/brands", json={"name": "Agent Loopr"})
    assert r.status_code == 403

def test_admin_creates_a_brand_and_gets_a_slug(client_admin):
    r = client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    assert r.status_code == 201
    assert r.json()["slug"] == "agent-loopr"

def test_slugs_are_unique(client_admin):
    client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    r = client_admin.post("/api/v1/brands", json={"name": "Agent Loopr"})
    assert r.status_code == 409

def test_every_member_sees_every_brand(client_admin, client_member):
    client_admin.post("/api/v1/brands", json={"name": "Ladder"})
    assert len(client_member.get("/api/v1/brands").json()) == 1
```

Shared fixtures — write these once, every later test file uses them:

```python
# backend/tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.models import Base, User, Role, Organization
from app.db.session import get_db
from app.core.security import current_user, LADDER_ORG_ID

@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    with maker() as s:
        s.add(Organization(id=LADDER_ORG_ID, name="Ladder"))
        s.commit()
        yield s

def _client(db_session, role):
    user = User(id=f"u-{role}", organization_id=LADDER_ORG_ID,
                email=f"{role}@ladder.com", auth_ref=f"sub-{role}", role=role)
    db_session.add(user); db_session.commit()
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[current_user] = lambda: user
    client = TestClient(app)
    client.user = user
    return client

@pytest.fixture
def client_admin(db_session):
    yield _client(db_session, Role.ADMIN)
    app.dependency_overrides.clear()

@pytest.fixture
def client_member(db_session):
    yield _client(db_session, Role.MEMBER)
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_brands.py -v`
Expected: FAIL, 404 on every route

- [ ] **Step 3: Write the schema**

```python
# backend/app/schemas/brand.py
from datetime import datetime
from pydantic import BaseModel, Field

class BrandCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

class BrandOut(BaseModel):
    id: str
    name: str
    slug: str
    created_at: datetime
    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the routes**

The slug is not cosmetic — it becomes the on-disk folder name under `design-systems/`, so it is constrained to a safe character set.

```python
# backend/app/api/v1/brands.py
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import current_user, require_admin, LADDER_ORG_ID
from app.db.session import get_db
from app.db.models import Brand, User
from app.schemas.brand import BrandCreate, BrandOut

router = APIRouter(prefix="/brands", tags=["brands"])

def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not slug:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "name has no usable characters")
    return slug[:80]

def get_brand(db: Session, brand_id: str) -> Brand:
    brand = db.get(Brand, brand_id)
    if brand is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "brand not found")
    return brand

@router.get("", response_model=list[BrandOut])
def list_brands(db: Session = Depends(get_db), _: User = Depends(current_user)):
    # PRD 2: no per-brand permission UI in v1 — every member sees every brand.
    return db.scalars(select(Brand).order_by(Brand.name)).all()

@router.post("", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
def create_brand(payload: BrandCreate, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)):
    slug = slugify(payload.name)
    if db.scalar(select(Brand).where(Brand.slug == slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"brand slug '{slug}' already exists")
    brand = Brand(organization_id=LADDER_ORG_ID, name=payload.name,
                  slug=slug, created_by=admin.id)
    db.add(brand); db.commit(); db.refresh(brand)
    return brand

@router.get("/{brand_id}", response_model=BrandOut)
def read_brand(brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    return get_brand(db, brand_id)
```

Register it in `router.py`: `api_router.include_router(brands.router)`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_brands.py -v`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/brand.py backend/app/api/v1/brands.py backend/app/api/v1/router.py backend/tests/
git commit -m "feat: brands crud with disk-safe slugs"
```

### Task 5: DESIGN.md and VOICE.md contracts

Both are versioned markdown edited by admins. Same shape, one module. (PRD §4.1, §4.2)

**Files:**
- Create: `backend/app/schemas/contract.py`
- Create: `backend/app/api/v1/contracts.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_contracts.py`

**Interfaces:**
- Consumes: `get_brand`, `require_admin`, `DesignSystem`, `BrandVoice`.
- Produces: `GET|PUT /api/v1/brands/{brand_id}/design`, `GET|PUT /api/v1/brands/{brand_id}/voice`. Also `latest_design(db, brand_id) -> DesignSystem | None` and `latest_voice(db, brand_id) -> BrandVoice | None` for Tasks 7 and 9.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_contracts.py
def _brand(client_admin):
    return client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]

def test_design_starts_empty(client_admin):
    bid = _brand(client_admin)
    assert client_admin.get(f"/api/v1/brands/{bid}/design").json()["content"] == ""

def test_put_design_creates_version_one(client_admin):
    bid = _brand(client_admin)
    r = client_admin.put(f"/api/v1/brands/{bid}/design", json={"content": "# Ladder"})
    assert r.json()["version"] == 1

def test_second_put_bumps_the_version(client_admin):
    bid = _brand(client_admin)
    client_admin.put(f"/api/v1/brands/{bid}/design", json={"content": "# a"})
    r = client_admin.put(f"/api/v1/brands/{bid}/design", json={"content": "# b"})
    assert r.json()["version"] == 2
    assert r.json()["content"] == "# b"

def test_voice_is_independent_of_design(client_admin):
    bid = _brand(client_admin)
    client_admin.put(f"/api/v1/brands/{bid}/design", json={"content": "# d"})
    r = client_admin.put(f"/api/v1/brands/{bid}/voice", json={"content": "# v"})
    assert r.json()["version"] == 1

def test_member_cannot_edit_a_contract(client_admin, client_member):
    bid = _brand(client_admin)
    r = client_member.put(f"/api/v1/brands/{bid}/design", json={"content": "x"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_contracts.py -v`
Expected: FAIL, 404 on the design routes

- [ ] **Step 3: Write the schema**

```python
# backend/app/schemas/contract.py
from datetime import datetime
from pydantic import BaseModel

class ContractIn(BaseModel):
    content: str

class ContractOut(BaseModel):
    content: str
    version: int
    updated_at: datetime | None = None
```

- [ ] **Step 4: Write the routes**

One row per brand, version bumped in place. Full history is not a v1 requirement and a second table would be speculative.

```python
# backend/app/api/v1/contracts.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user, require_admin
from app.db.session import get_db
from app.db.models import DesignSystem, BrandVoice, User
from app.schemas.contract import ContractIn, ContractOut

router = APIRouter(prefix="/brands/{brand_id}", tags=["contracts"])

def latest_design(db: Session, brand_id: str) -> DesignSystem | None:
    return db.scalar(select(DesignSystem).where(DesignSystem.brand_id == brand_id))

def latest_voice(db: Session, brand_id: str) -> BrandVoice | None:
    return db.scalar(select(BrandVoice).where(BrandVoice.brand_id == brand_id))

def _read(row, field: str) -> ContractOut:
    if row is None:
        return ContractOut(content="", version=0)
    return ContractOut(content=getattr(row, field), version=row.version,
                       updated_at=row.updated_at)

def _write(db: Session, row, model, field: str, brand_id: str, content: str) -> ContractOut:
    if row is None:
        row = model(brand_id=brand_id, version=1, **{field: content})
        db.add(row)
    else:
        setattr(row, field, content)
        row.version += 1
    db.commit(); db.refresh(row)
    return ContractOut(content=getattr(row, field), version=row.version,
                       updated_at=row.updated_at)

@router.get("/design", response_model=ContractOut)
def read_design(brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    get_brand(db, brand_id)
    return _read(latest_design(db, brand_id), "design_md_content")

@router.put("/design", response_model=ContractOut)
def write_design(brand_id: str, payload: ContractIn, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)):
    get_brand(db, brand_id)
    return _write(db, latest_design(db, brand_id), DesignSystem,
                  "design_md_content", brand_id, payload.content)

@router.get("/voice", response_model=ContractOut)
def read_voice(brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    get_brand(db, brand_id)
    return _read(latest_voice(db, brand_id), "voice_md_content")

@router.put("/voice", response_model=ContractOut)
def write_voice(brand_id: str, payload: ContractIn, db: Session = Depends(get_db),
                _: User = Depends(require_admin)):
    get_brand(db, brand_id)
    return _write(db, latest_voice(db, brand_id), BrandVoice,
                  "voice_md_content", brand_id, payload.content)
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_contracts.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/contract.py backend/app/api/v1/contracts.py backend/app/api/v1/router.py backend/tests/test_contracts.py
git commit -m "feat: versioned DESIGN.md and VOICE.md per brand"
```

### Task 6: Supabase Storage service

Files are stored in Supabase Storage, never in Postgres. (Decision recorded: Storage ships with the Supabase project already in the stack, so it adds no service and no bill.)

**Files:**
- Create: `backend/app/services/storage.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Produces: `put(key: str, data: bytes, content_type: str) -> str` (returns the key); `get(key: str) -> bytes`; `signed_url(key: str, expires_seconds: int = 3600) -> str`; `delete(key: str) -> None`; `key_for(brand_slug: str, kind: str, filename: str) -> str`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_storage.py
import pytest
from app.services import storage

def test_key_is_namespaced_by_brand_and_kind():
    key = storage.key_for("ladder", "assets", "logo.svg")
    assert key.startswith("ladder/assets/")
    assert key.endswith("-logo.svg")

def test_key_rejects_path_traversal():
    with pytest.raises(ValueError):
        storage.key_for("ladder", "assets", "../../etc/passwd")

def test_put_then_get_round_trips(fake_storage):
    key = storage.put("ladder/assets/x.txt", b"hello", "text/plain")
    assert storage.get(key) == b"hello"
```

```python
# add to backend/tests/conftest.py
@pytest.fixture
def fake_storage(monkeypatch):
    """In-memory stand-in. Storage is a thin wrapper; hitting the network in
    unit tests would test Supabase, not us."""
    from app.services import storage
    store: dict[str, bytes] = {}
    monkeypatch.setattr(storage, "_put_bytes", lambda k, d, c: store.__setitem__(k, d))
    monkeypatch.setattr(storage, "_get_bytes", lambda k: store[k])
    monkeypatch.setattr(storage, "_remove", lambda k: store.pop(k, None))
    return store
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.storage'`

- [ ] **Step 3: Write the service**

```python
# backend/app/services/storage.py
"""Supabase Storage wrapper. The only module that knows the bucket exists."""
from __future__ import annotations
import re
import uuid
from functools import lru_cache

from supabase import create_client, Client
from app.core.config import settings

_SAFE = re.compile(r"^[A-Za-z0-9._-]+$")

@lru_cache(maxsize=1)
def _client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)

def _bucket():
    return _client().storage.from_(settings.STORAGE_BUCKET)

def key_for(brand_slug: str, kind: str, filename: str) -> str:
    """Namespace by brand so per-brand isolation is a prefix, not a convention.

    The filename is checked rather than sanitised: a rejected upload is a clear
    error, a silently renamed one is a support ticket six months later.
    """
    if not _SAFE.match(filename):
        raise ValueError(f"unsafe filename: {filename!r}")
    return f"{brand_slug}/{kind}/{uuid.uuid4().hex[:8]}-{filename}"

def _put_bytes(key: str, data: bytes, content_type: str) -> None:
    _bucket().upload(key, data, {"content-type": content_type, "upsert": "true"})

def _get_bytes(key: str) -> bytes:
    return _bucket().download(key)

def _remove(key: str) -> None:
    _bucket().remove([key])

def put(key: str, data: bytes, content_type: str) -> str:
    _put_bytes(key, data, content_type)
    return key

def get(key: str) -> bytes:
    return _get_bytes(key)

def delete(key: str) -> None:
    _remove(key)

def signed_url(key: str, expires_seconds: int = 3600) -> str:
    result = _bucket().create_signed_url(key, expires_seconds)
    return result["signedURL"]
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_storage.py -v`
Expected: 3 passed

- [ ] **Step 5: Create the bucket**

In the Supabase dashboard, create a **private** bucket named `content-studio`. Private is deliberate: exports reach the browser through `signed_url`, so revoking access is a matter of not signing a new URL.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/storage.py backend/tests/test_storage.py backend/tests/conftest.py
git commit -m "feat: supabase storage wrapper with brand-namespaced keys"
```

### Task 7: Brand sync — database to shared volume

open-design reads design systems and assets off disk and offers no write API, so the app materialises them before every generation. (PRD §7.2)

**Files:**
- Create: `backend/app/services/brand_sync.py`
- Test: `backend/tests/test_brand_sync.py`

**Interfaces:**
- Consumes: `latest_design`, `latest_voice` (Task 5), `storage.get` (Task 6), `Brand`, `BrandAsset`.
- Produces: `sync_brand(db, brand) -> Path` returning the brand's root on the shared volume; `brand_root(slug) -> Path`; `fonts_dir(slug) -> Path`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_brand_sync.py
from pathlib import Path
from app.db.models import Brand, DesignSystem, BrandAsset, AssetType
from app.services import brand_sync

def test_sync_writes_design_md(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(brand_sync.settings, "SHARED_VOLUME_ROOT", str(tmp_path))
    brand = Brand(organization_id="o", name="Ladder", slug="ladder")
    db_session.add(brand); db_session.flush()
    db_session.add(DesignSystem(brand_id=brand.id, design_md_content="# Ladder", version=1))
    db_session.commit()

    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "DESIGN.md").read_text() == "# Ladder"

def test_fonts_land_in_a_fonts_dir(db_session, tmp_path, monkeypatch, fake_storage):
    from app.services import storage
    monkeypatch.setattr(brand_sync.settings, "SHARED_VOLUME_ROOT", str(tmp_path))
    storage.put("ladder/assets/x-Inter.ttf", b"FONTBYTES", "font/ttf")
    brand = Brand(organization_id="o", name="Ladder", slug="ladder")
    db_session.add(brand); db_session.flush()
    db_session.add(BrandAsset(brand_id=brand.id, asset_type=AssetType.FONT,
                              file_ref="ladder/assets/x-Inter.ttf", label="Inter"))
    db_session.commit()

    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "fonts" / "x-Inter.ttf").read_bytes() == b"FONTBYTES"

def test_sync_is_idempotent(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(brand_sync.settings, "SHARED_VOLUME_ROOT", str(tmp_path))
    brand = Brand(organization_id="o", name="Ladder", slug="ladder")
    db_session.add(brand); db_session.flush()
    db_session.add(DesignSystem(brand_id=brand.id, design_md_content="# v1", version=1))
    db_session.commit()
    brand_sync.sync_brand(db_session, brand)
    root = brand_sync.sync_brand(db_session, brand)
    assert (root / "DESIGN.md").read_text() == "# v1"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_brand_sync.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.brand_sync'`

- [ ] **Step 3: Write the service**

```python
# backend/app/services/brand_sync.py
"""Materialise a brand's contracts and assets onto the shared volume.

open-design's documented way to add a design system is to drop a folder on
disk; there is no create/update endpoint (PRD 7.2). So the database stays the
source of truth and the filesystem is a rebuildable projection of it.
"""
from __future__ import annotations
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Brand, BrandAsset, AssetType
from app.services import storage
from app.api.v1.contracts import latest_design, latest_voice

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
    _write_if_changed(root / "DESIGN.md", (design.design_md_content if design else "").encode())

    voice = latest_voice(db, brand.id)
    _write_if_changed(root / "VOICE.md", (voice.voice_md_content if voice else "").encode())

    assets = db.scalars(select(BrandAsset).where(BrandAsset.brand_id == brand.id)).all()
    for asset in assets:
        filename = asset.file_ref.rsplit("/", 1)[-1]
        # PRD 4.4: fonts are self-hosted in the container, never host-resolved.
        target = fonts_dir(brand.slug) if asset.asset_type == AssetType.FONT else root / "assets"
        _write_if_changed(target / filename, storage.get(asset.file_ref))

    if any(a.asset_type == AssetType.FONT for a in assets):
        _register_fonts(brand.slug)
    return root

def _register_fonts(slug: str) -> None:
    """Point fontconfig at the brand's font directory.

    ponytail: writes a per-brand fonts.conf and refreshes the cache. If the
    open-design image ever ships its own fontconfig setup, delete this and use
    theirs instead of maintaining two.
    """
    import subprocess
    conf = brand_root(slug) / "fonts.conf"
    conf.write_text(
        '<?xml version="1.0"?><fontconfig>'
        f"<dir>{fonts_dir(slug)}</dir>"
        "</fontconfig>"
    )
    subprocess.run(["fc-cache", "-f", str(fonts_dir(slug))], check=False)
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_brand_sync.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/brand_sync.py backend/tests/test_brand_sync.py
git commit -m "feat: sync brand contracts, assets and fonts to the shared volume"
```

### Task 8: The open-design adapter

The only module in the codebase that knows open-design exists. (PRD §7.4)

**Files:**
- Create: `backend/app/services/open_design.py`
- Test: `backend/tests/test_open_design.py`

**Interfaces:**
- Produces: dataclass `GenerationRequest(brand_slug, artifact_type, mode, copy_text, design_md, reference_specs, asset_paths, skill_paths, model_name, variant_index)`; dataclass `GenerationOutcome(project_ref, export_urls, log)`; `generate(req) -> GenerationOutcome`; `edit(project_ref, instruction) -> GenerationOutcome`; `download_export(url) -> bytes`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_open_design.py
import httpx, pytest
from app.services import open_design as od

def _transport(handler):
    return httpx.MockTransport(handler)

def test_generate_returns_project_ref_and_exports(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/generate"
        return httpx.Response(200, json={
            "projectId": "proj_42",
            "exports": {"png": "http://od/e/1.png"},
            "log": "done",
        })
    monkeypatch.setattr(od, "_transport_for_tests", _transport(handler))
    outcome = od.generate(od.GenerationRequest(
        brand_slug="ladder", artifact_type="carousel", mode="code",
        copy_text="hello", design_md="# Ladder", reference_specs=[],
        asset_paths=[], skill_paths=[], model_name="claude", variant_index=0))
    assert outcome.project_ref == "proj_42"
    assert outcome.export_urls == {"png": "http://od/e/1.png"}

def test_generate_raises_a_typed_error_on_daemon_failure(monkeypatch):
    monkeypatch.setattr(od, "_transport_for_tests",
                        _transport(lambda r: httpx.Response(500, text="boom")))
    with pytest.raises(od.OpenDesignError) as exc:
        od.generate(od.GenerationRequest(
            brand_slug="ladder", artifact_type="deck", mode="code",
            copy_text="x", design_md="", reference_specs=[], asset_paths=[],
            skill_paths=[], model_name="claude", variant_index=0))
    assert "500" in str(exc.value)

def test_edit_posts_the_instruction_to_chat(monkeypatch):
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json={"projectId": "proj_42", "exports": {}, "log": ""})
    monkeypatch.setattr(od, "_transport_for_tests", _transport(handler))
    od.edit("proj_42", "make the headline bigger")
    assert seen["path"] == "/api/chat"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_open_design.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.open_design'`

- [ ] **Step 3: Write the adapter**

Paths and payload keys come from `docs/phase0-findings.md`. If they differ from the placeholders below, change them **here only** — no other module may learn them.

```python
# backend/app/services/open_design.py
"""The single seam to open-design.

PRD 7.4: this category is young. Everything open-design-shaped is confined to
this file so replacing it is an integration swap, not a rewrite. Nothing here
leaks into the schema, the API, or the QA gate.
"""
from __future__ import annotations
from dataclasses import dataclass, field

import httpx
from app.core.config import settings

# Swapped by tests; None in production.
_transport_for_tests: httpx.MockTransport | None = None

class OpenDesignError(RuntimeError):
    """The daemon could not be reached, or refused the request."""

@dataclass
class GenerationRequest:
    brand_slug: str
    artifact_type: str
    mode: str                       # code | image
    copy_text: str
    design_md: str
    reference_specs: list[str] = field(default_factory=list)
    asset_paths: list[str] = field(default_factory=list)
    skill_paths: list[str] = field(default_factory=list)
    model_name: str = ""
    variant_index: int = 0

@dataclass
class GenerationOutcome:
    project_ref: str
    export_urls: dict[str, str]
    log: str

def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.OPEN_DESIGN_BASE_URL,
        timeout=settings.OPEN_DESIGN_TIMEOUT_SECONDS,
        transport=_transport_for_tests,
    )

def _post(path: str, payload: dict) -> GenerationOutcome:
    try:
        with _client() as client:
            response = client.post(path, json=payload)
    except httpx.HTTPError as exc:
        raise OpenDesignError(f"open-design unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise OpenDesignError(f"open-design returned {response.status_code}: {response.text[:400]}")
    body = response.json()
    return GenerationOutcome(
        project_ref=str(body.get("projectId") or ""),
        export_urls=dict(body.get("exports") or {}),
        log=str(body.get("log") or ""),
    )

def generate(req: GenerationRequest) -> GenerationOutcome:
    return _post("/api/generate", {
        "designSystem": req.brand_slug,
        "type": req.artifact_type,
        "mode": req.mode,
        "content": req.copy_text,
        "designMarkdown": req.design_md,
        "references": req.reference_specs,
        "assets": req.asset_paths,
        "skills": req.skill_paths,
        "model": req.model_name,
        "variant": req.variant_index,
    })

def edit(project_ref: str, instruction: str) -> GenerationOutcome:
    """PRD 5.4: proxy to the existing conversational edit loop; works for both modes."""
    return _post("/api/chat", {"projectId": project_ref, "message": instruction})

def download_export(url: str) -> bytes:
    try:
        with _client() as client:
            response = client.get(url)
            response.raise_for_status()
            return response.content
    except httpx.HTTPError as exc:
        raise OpenDesignError(f"export download failed: {exc}") from exc
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_open_design.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/open_design.py backend/tests/test_open_design.py
git commit -m "feat: single-seam open-design adapter"
```

### Task 9: Copy generation against VOICE.md

**Files:**
- Create: `backend/app/prompts/ai_tells.py`
- Create: `backend/app/prompts/copy_prompt.py`
- Create: `backend/app/services/copy_gen.py`
- Test: `backend/tests/test_copy_gen.py`

**Interfaces:**
- Consumes: `latest_voice` (Task 5).
- Produces: `build_copy_prompt(brief: str, voice_md: str, artifact_type: str) -> str`; `generate_copy(brief, voice_md, artifact_type, model_name) -> str`.

- [ ] **Step 1: Port the AI-tell guardrails**

Copy `BANNED_AI_TELLS` **verbatim** from LadderFlow `version_two/backend/app/prompts/ai_tells.py` into `backend/app/prompts/ai_tells.py`. It is already the single source of truth there for banned words, phrases, punctuation, sentence constructions, structures, openers and closers, plus the positive "write like a human" directives. Do not paraphrase it and do not shorten it. Keep the module docstring's warning intact: the string must stay brace-free because every consumer runs it through `str.format()`.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_copy_gen.py
import pytest
from app.services import copy_gen
from app.prompts.ai_tells import BANNED_AI_TELLS

def test_prompt_carries_the_voice_contract():
    prompt = copy_gen.build_copy_prompt("launch post", "# Voice\nBlunt.", "social_post")
    assert "Blunt." in prompt

def test_prompt_carries_the_ai_tell_guardrails():
    prompt = copy_gen.build_copy_prompt("launch post", "# Voice", "carousel")
    assert BANNED_AI_TELLS in prompt

def test_prompt_names_the_artifact_type():
    prompt = copy_gen.build_copy_prompt("x", "# Voice", "deck")
    assert "deck" in prompt

def test_empty_voice_is_refused():
    with pytest.raises(ValueError, match="VOICE.md"):
        copy_gen.build_copy_prompt("x", "   ", "deck")

def test_ai_tells_string_is_brace_free():
    assert "{" not in BANNED_AI_TELLS and "}" not in BANNED_AI_TELLS
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pytest tests/test_copy_gen.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.copy_gen'`

- [ ] **Step 4: Write the prompt builder**

```python
# backend/app/prompts/copy_prompt.py
COPY_SYSTEM = (
    "You write copy for one specific brand. The brand's voice contract is law: "
    "where your instincts and the contract disagree, the contract wins. "
    "Return only the copy. No preamble, no explanation, no options."
)

COPY_TEMPLATE = """<voice_contract>
{voice_md}
</voice_contract>

{ai_tells}

<task>
Write the copy for one {artifact_type}.
</task>

<brief>
{brief}
</brief>

<constraints>
Every claim must trace to something concrete in the brief. No asserted
adjective without evidence behind it.
Do not describe layout, slides, cards or images. Another agent designs those.
</constraints>

<output>
The copy only.
</output>"""
```

```python
# backend/app/services/copy_gen.py
"""Copy is generated against VOICE.md and approved before design begins.

PRD 5.2: if the layout agent writes the words in the same pass, the words get
shaped to fill boxes. For B2B the words are the differentiator, so this stage
is separate on purpose.
"""
from __future__ import annotations

from app.prompts.ai_tells import BANNED_AI_TELLS
from app.prompts.copy_prompt import COPY_SYSTEM, COPY_TEMPLATE

def build_copy_prompt(brief: str, voice_md: str, artifact_type: str) -> str:
    if not (voice_md or "").strip():
        raise ValueError("brand has no VOICE.md; author it before generating copy")
    return COPY_TEMPLATE.format(
        voice_md=voice_md.strip(),
        ai_tells=BANNED_AI_TELLS,
        artifact_type=artifact_type,
        brief=brief.strip(),
    )

def generate_copy(brief: str, voice_md: str, artifact_type: str, model_name: str) -> str:
    """One call to the selected coding-agent provider through open-design's BYOK proxy."""
    from app.services.open_design import _client, OpenDesignError
    prompt = build_copy_prompt(brief, voice_md, artifact_type)
    try:
        with _client() as client:
            response = client.post("/api/complete", json={
                "model": model_name, "system": COPY_SYSTEM, "prompt": prompt,
            })
            response.raise_for_status()
    except Exception as exc:
        raise OpenDesignError(f"copy generation failed: {exc}") from exc
    return str(response.json().get("text") or "").strip()
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_copy_gen.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/prompts backend/app/services/copy_gen.py backend/tests/test_copy_gen.py
git commit -m "feat: copy stage against VOICE.md with ported ai-tell guardrails"
```

### Task 10: Briefs and the copy approval gate

**Files:**
- Create: `backend/app/schemas/brief.py`, `backend/app/schemas/copy.py`
- Create: `backend/app/api/v1/briefs.py`, `backend/app/api/v1/copy.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_briefs.py`, `backend/tests/test_copy_api.py`

**Interfaces:**
- Consumes: `generate_copy`, `latest_voice`, `get_brand`, `current_user`, `require_admin`.
- Produces: `POST|GET /api/v1/briefs`, `GET /api/v1/briefs/{brief_id}`; `POST /api/v1/briefs/{brief_id}/copy` (generate or paste), `PATCH /api/v1/copy/{copy_id}`, `POST /api/v1/copy/{copy_id}/approve` (admin). Also `get_approved_copy(db, copy_id) -> Copy` raising 409 when not approved — Task 12 depends on it.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_copy_api.py
def _setup(client_admin):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    client_admin.put(f"/api/v1/brands/{bid}/voice", json={"content": "# Voice\nBlunt."})
    brief = client_admin.post("/api/v1/briefs",
                              json={"brand_id": bid, "content": "launch"}).json()
    return bid, brief["id"]

def test_member_can_paste_copy_directly(client_admin, client_member):
    _, brief_id = _setup(client_admin)
    r = client_member.post(f"/api/v1/briefs/{brief_id}/copy",
                           json={"content": "Hand written.", "generate": False})
    assert r.status_code == 201
    assert r.json()["status"] == "draft"
    assert r.json()["generated_by_model_id"] is None

def test_generated_copy_records_the_model(client_admin, stub_copy_model):
    _, brief_id = _setup(client_admin)
    r = client_admin.post(f"/api/v1/briefs/{brief_id}/copy",
                          json={"generate": True, "model_provider_id": stub_copy_model})
    assert r.json()["generated_by_model_id"] == stub_copy_model

def test_editing_copy_bumps_version_and_resets_to_draft(client_admin):
    _, brief_id = _setup(client_admin)
    cid = client_admin.post(f"/api/v1/briefs/{brief_id}/copy",
                            json={"content": "a", "generate": False}).json()["id"]
    client_admin.post(f"/api/v1/copy/{cid}/approve")
    r = client_admin.patch(f"/api/v1/copy/{cid}", json={"content": "b"})
    assert r.json()["version"] == 2
    assert r.json()["status"] == "draft"

def test_member_cannot_approve_copy(client_admin, client_member):
    _, brief_id = _setup(client_admin)
    cid = client_member.post(f"/api/v1/briefs/{brief_id}/copy",
                             json={"content": "a", "generate": False}).json()["id"]
    assert client_member.post(f"/api/v1/copy/{cid}/approve").status_code == 403

def test_generation_without_voice_md_is_refused(client_admin, stub_copy_model):
    bid = client_admin.post("/api/v1/brands", json={"name": "NoVoice"}).json()["id"]
    brief_id = client_admin.post("/api/v1/briefs",
                                 json={"brand_id": bid, "content": "x"}).json()["id"]
    r = client_admin.post(f"/api/v1/briefs/{brief_id}/copy",
                          json={"generate": True, "model_provider_id": stub_copy_model})
    assert r.status_code == 422
    assert "VOICE.md" in r.json()["detail"]
```

```python
# add to backend/tests/conftest.py
@pytest.fixture
def stub_copy_model(db_session, monkeypatch):
    from app.db.models import ModelProvider, ProviderType
    from app.core.security import LADDER_ORG_ID
    from app.services import copy_gen
    provider = ModelProvider(organization_id=LADDER_ORG_ID,
                             type=ProviderType.CODING_AGENT, name="claude",
                             credential_ref="vault://claude")
    db_session.add(provider); db_session.commit()
    monkeypatch.setattr(copy_gen, "generate_copy",
                        lambda brief, voice_md, artifact_type, model_name: "Generated copy.")
    return provider.id
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_copy_api.py -v`
Expected: FAIL, 404 on `/api/v1/briefs`

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/brief.py
from datetime import datetime
from pydantic import BaseModel, Field

class BriefCreate(BaseModel):
    brand_id: str
    content: str = Field(min_length=1)
    source: str = "manual"
    research_run_id: str | None = None

class BriefOut(BaseModel):
    id: str
    brand_id: str
    content: str
    source: str
    research_run_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}
```

```python
# backend/app/schemas/copy.py
from datetime import datetime
from pydantic import BaseModel, model_validator

class CopyCreate(BaseModel):
    generate: bool = False
    content: str | None = None
    model_provider_id: str | None = None
    artifact_type: str = "social_post"

    @model_validator(mode="after")
    def one_path_or_the_other(self):
        if self.generate and not self.model_provider_id:
            raise ValueError("model_provider_id is required when generate is true")
        if not self.generate and not (self.content or "").strip():
            raise ValueError("content is required when generate is false")
        return self

class CopyUpdate(BaseModel):
    content: str

class CopyOut(BaseModel):
    id: str
    brief_id: str
    brand_id: str
    content: str
    status: str
    version: int
    generated_by_model_id: str | None
    approved_by: str | None
    created_at: datetime
    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the briefs router**

```python
# backend/app/api/v1/briefs.py
from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user
from app.db.session import get_db
from app.db.models import Brief, User
from app.schemas.brief import BriefCreate, BriefOut

router = APIRouter(prefix="/briefs", tags=["briefs"])

@router.post("", response_model=BriefOut, status_code=status.HTTP_201_CREATED)
def create_brief(payload: BriefCreate, db: Session = Depends(get_db),
                 user: User = Depends(current_user)):
    get_brand(db, payload.brand_id)
    brief = Brief(brand_id=payload.brand_id, created_by=user.id,
                  source=payload.source, content=payload.content,
                  research_run_id=payload.research_run_id)
    db.add(brief); db.commit(); db.refresh(brief)
    return brief

@router.get("", response_model=list[BriefOut])
def list_briefs(brand_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    return db.scalars(
        select(Brief).where(Brief.brand_id == brand_id).order_by(Brief.created_at.desc())
    ).all()

@router.get("/{brief_id}", response_model=BriefOut)
def read_brief(brief_id: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    from app.api.v1.copy import get_brief
    return get_brief(db, brief_id)
```

- [ ] **Step 5: Write the copy router**

```python
# backend/app/api/v1/copy.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.v1.contracts import latest_voice
from app.core.security import current_user, require_admin
from app.db.session import get_db
from app.db.models import Brief, Copy, CopyStatus, ModelProvider, User
from app.schemas.copy import CopyCreate, CopyUpdate, CopyOut
from app.services import copy_gen

router = APIRouter(tags=["copy"])

def get_brief(db: Session, brief_id: str) -> Brief:
    brief = db.get(Brief, brief_id)
    if brief is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "brief not found")
    return brief

def get_copy(db: Session, copy_id: str) -> Copy:
    row = db.get(Copy, copy_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "copy not found")
    return row

def get_approved_copy(db: Session, copy_id: str) -> Copy:
    """PRD 5.2: the design agent consumes approved copy; it does not write it."""
    row = get_copy(db, copy_id)
    if row.status != CopyStatus.APPROVED:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "copy must be approved before design can start")
    return row

@router.post("/briefs/{brief_id}/copy", response_model=CopyOut,
             status_code=status.HTTP_201_CREATED)
def create_copy(brief_id: str, payload: CopyCreate, db: Session = Depends(get_db),
                user: User = Depends(current_user)):
    brief = get_brief(db, brief_id)
    model_id = None
    if payload.generate:
        provider = db.get(ModelProvider, payload.model_provider_id)
        if provider is None or not provider.enabled:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model not available")
        voice = latest_voice(db, brief.brand_id)
        try:
            content = copy_gen.generate_copy(
                brief.content, voice.voice_md_content if voice else "",
                payload.artifact_type, provider.name)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        model_id = provider.id
    else:
        # PRD 5.2: writing copy by hand is first-class, not a fallback.
        content = payload.content

    row = Copy(brief_id=brief.id, brand_id=brief.brand_id, content=content,
               status=CopyStatus.DRAFT, generated_by_model_id=model_id,
               version=1, created_by=user.id)
    db.add(row); db.commit(); db.refresh(row)
    return row

@router.patch("/copy/{copy_id}", response_model=CopyOut)
def update_copy(copy_id: str, payload: CopyUpdate, db: Session = Depends(get_db),
                _: User = Depends(current_user)):
    row = get_copy(db, copy_id)
    row.content = payload.content
    row.version += 1
    # An edit invalidates the approval it was granted under.
    row.status = CopyStatus.DRAFT
    row.approved_by = None
    db.commit(); db.refresh(row)
    return row

@router.post("/copy/{copy_id}/approve", response_model=CopyOut)
def approve_copy(copy_id: str, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)):
    row = get_copy(db, copy_id)
    row.status = CopyStatus.APPROVED
    row.approved_by = admin.id
    db.commit(); db.refresh(row)
    return row
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pytest tests/test_copy_api.py tests/test_briefs.py -v`
Expected: all passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas backend/app/api/v1/briefs.py backend/app/api/v1/copy.py backend/app/api/v1/router.py backend/tests/
git commit -m "feat: briefs and the copy approval gate"
```

### Task 11: Durable job queue

Postgres-backed with `FOR UPDATE SKIP LOCKED`. The `GenerationJob` table already exists (PRD §8), so this adds no infrastructure — no Redis, no Celery. (PRD §7.1)

**Files:**
- Create: `backend/app/workers/queue.py`
- Test: `backend/tests/test_queue.py`

**Interfaces:**
- Consumes: `GenerationJob`, `JobState`, `SessionLocal`.
- Produces: `enqueue(db, artifact_id) -> GenerationJob`; `claim(db) -> GenerationJob | None`; `report_progress(db, job_id, stage, percent, detail="") -> None`; `succeed(db, job_id) -> None`; `fail(db, job_id, error, retryable=True) -> None`; `MAX_ATTEMPTS = 3`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_queue.py
import pytest
from app.workers import queue
from app.db.models import GenerationJob, JobState

def test_enqueue_creates_a_queued_job(db_session):
    job = queue.enqueue(db_session, "art-1")
    assert job.state == JobState.QUEUED
    assert job.attempts == 0

def test_claim_returns_the_oldest_queued_job_and_marks_it_running(db_session):
    queue.enqueue(db_session, "art-1")
    queue.enqueue(db_session, "art-2")
    job = queue.claim(db_session)
    assert job.artifact_id == "art-1"
    assert job.state == JobState.RUNNING
    assert job.started_at is not None
    assert job.attempts == 1

def test_claim_returns_none_when_the_queue_is_empty(db_session):
    assert queue.claim(db_session) is None

def test_a_claimed_job_is_not_claimed_twice(db_session):
    queue.enqueue(db_session, "art-1")
    queue.claim(db_session)
    assert queue.claim(db_session) is None

def test_progress_is_readable_by_a_reconnecting_client(db_session):
    job = queue.enqueue(db_session, "art-1")
    queue.claim(db_session)
    queue.report_progress(db_session, job.id, "generating", 40, "calling open-design")
    db_session.refresh(job)
    assert job.progress_ref["stage"] == "generating"
    assert job.progress_ref["percent"] == 40

def test_a_retryable_failure_returns_the_job_to_the_queue(db_session):
    job = queue.enqueue(db_session, "art-1")
    queue.claim(db_session)
    queue.fail(db_session, job.id, "daemon timeout", retryable=True)
    db_session.refresh(job)
    assert job.state == JobState.QUEUED

def test_a_job_stops_retrying_after_max_attempts(db_session):
    job = queue.enqueue(db_session, "art-1")
    for _ in range(queue.MAX_ATTEMPTS):
        queue.claim(db_session)
        queue.fail(db_session, job.id, "boom", retryable=True)
    db_session.refresh(job)
    assert job.state == JobState.FAILED
    assert job.error == "boom"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_queue.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.workers.queue'`

- [ ] **Step 3: Write the queue**

```python
# backend/app/workers/queue.py
"""Durable generation queue on Postgres.

PRD 7.1: agentic generation of a deck takes minutes, so generation cannot be
request/response and jobs must survive an app restart. The GenerationJob table
is already in the schema, so SELECT ... FOR UPDATE SKIP LOCKED gives a correct
multi-worker queue with no broker to run, monitor or pay for.
"""
from __future__ import annotations
from datetime import datetime, UTC

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GenerationJob, JobState

MAX_ATTEMPTS = 3

def _now() -> datetime:
    return datetime.now(UTC)

def enqueue(db: Session, artifact_id: str) -> GenerationJob:
    job = GenerationJob(artifact_id=artifact_id, state=JobState.QUEUED,
                        progress_ref={"stage": "queued", "percent": 0, "detail": ""})
    db.add(job); db.commit(); db.refresh(job)
    return job

def claim(db: Session) -> GenerationJob | None:
    """Take one queued job. SKIP LOCKED lets N workers poll the same table safely."""
    job = db.scalar(
        select(GenerationJob)
        .where(GenerationJob.state == JobState.QUEUED)
        .order_by(GenerationJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job is None:
        return None
    job.state = JobState.RUNNING
    job.started_at = _now()
    job.attempts += 1
    job.progress_ref = {"stage": "starting", "percent": 1, "detail": ""}
    db.commit(); db.refresh(job)
    return job

def report_progress(db: Session, job_id: str, stage: str, percent: int,
                    detail: str = "") -> None:
    """Progress lives in the row, not in memory.

    That is what makes the stream reconnectable (PRD 7.1): a member who closes
    a laptop and returns reads the same row the worker has been writing.
    """
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.progress_ref = {"stage": stage, "percent": max(0, min(100, percent)),
                        "detail": detail, "at": _now().isoformat()}
    db.commit()

def succeed(db: Session, job_id: str) -> None:
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.state = JobState.SUCCEEDED
    job.finished_at = _now()
    job.progress_ref = {"stage": "done", "percent": 100, "detail": ""}
    db.commit()

def fail(db: Session, job_id: str, error: str, retryable: bool = True) -> None:
    job = db.get(GenerationJob, job_id)
    if job is None:
        return
    job.error = error
    if retryable and job.attempts < MAX_ATTEMPTS:
        job.state = JobState.QUEUED
        job.started_at = None
    else:
        job.state = JobState.FAILED
        job.finished_at = _now()
    db.commit()
```

- [ ] **Step 4: Run the tests and watch them pass**

`with_for_update` is a no-op on SQLite, which is fine — these tests cover the state machine. Concurrency itself is covered in Step 5.

Run: `pytest tests/test_queue.py -v`
Expected: 7 passed

- [ ] **Step 5: Write the concurrency test against real Postgres**

```python
# backend/tests/test_queue_postgres.py
import os, pytest
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.models import Base
from app.workers import queue

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"),
                                reason="needs a real postgres")

def test_two_workers_never_claim_the_same_job():
    engine = create_engine(os.environ["TEST_DATABASE_URL"])
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    with maker() as s:
        queue.enqueue(s, "art-1")

    def worker():
        with maker() as s:
            job = queue.claim(s)
            return job.id if job else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [f.result() for f in [pool.submit(worker), pool.submit(worker)]]
    assert sorted(r is None for r in results) == [False, True]
```

Run: `TEST_DATABASE_URL=postgresql+psycopg://... pytest tests/test_queue_postgres.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/workers/queue.py backend/tests/test_queue.py backend/tests/test_queue_postgres.py
git commit -m "feat: postgres skip-locked generation queue with bounded retries"
```

### Task 12: Artifact creation, the worker, and the end-to-end generation path

**Files:**
- Create: `backend/app/schemas/artifact.py`
- Create: `backend/app/api/v1/artifacts.py`
- Create: `backend/app/workers/generation_worker.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_artifacts.py`, `backend/tests/test_worker.py`

**Interfaces:**
- Consumes: `get_approved_copy` (Task 10), `enqueue`/`claim`/`report_progress`/`succeed`/`fail` (Task 11), `sync_brand` (Task 7), `open_design.generate`/`edit` (Task 8), `latest_design` (Task 5).
- Produces: `POST /api/v1/artifacts` (body accepts `variants: int = 1`), `GET /api/v1/artifacts/{artifact_id}`, `POST /api/v1/artifacts/{artifact_id}/iterate`. Also `run_job(db, job) -> None` — the unit the worker loop calls, tested directly.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_artifacts.py
def _ready_copy(client_admin):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    client_admin.put(f"/api/v1/brands/{bid}/design", json={"content": "# D"})
    client_admin.put(f"/api/v1/brands/{bid}/voice", json={"content": "# V"})
    brief = client_admin.post("/api/v1/briefs",
                              json={"brand_id": bid, "content": "launch"}).json()
    cid = client_admin.post(f"/api/v1/briefs/{brief['id']}/copy",
                            json={"content": "Words.", "generate": False}).json()["id"]
    return bid, brief["id"], cid

def test_design_is_refused_while_copy_is_draft(client_admin, stub_provider):
    bid, brief_id, cid = _ready_copy(client_admin)
    r = client_admin.post("/api/v1/artifacts", json={
        "brand_id": bid, "brief_id": brief_id, "copy_id": cid,
        "artifact_type": "carousel", "model_provider_id": stub_provider})
    assert r.status_code == 409
    assert "approved" in r.json()["detail"]

def test_approved_copy_produces_a_queued_artifact(client_admin, stub_provider):
    bid, brief_id, cid = _ready_copy(client_admin)
    client_admin.post(f"/api/v1/copy/{cid}/approve")
    r = client_admin.post("/api/v1/artifacts", json={
        "brand_id": bid, "brief_id": brief_id, "copy_id": cid,
        "artifact_type": "carousel", "model_provider_id": stub_provider})
    assert r.status_code == 201
    assert r.json()[0]["status"] == "queued"
    assert r.json()[0]["generation_mode"] == "code"

def test_image_type_selects_image_mode(client_admin, stub_image_provider):
    bid, brief_id, cid = _ready_copy(client_admin)
    client_admin.post(f"/api/v1/copy/{cid}/approve")
    r = client_admin.post("/api/v1/artifacts", json={
        "brand_id": bid, "brief_id": brief_id, "copy_id": cid,
        "artifact_type": "image", "model_provider_id": stub_image_provider})
    assert r.json()[0]["generation_mode"] == "image"

def test_variants_share_a_group_id(client_admin, stub_provider):
    bid, brief_id, cid = _ready_copy(client_admin)
    client_admin.post(f"/api/v1/copy/{cid}/approve")
    rows = client_admin.post("/api/v1/artifacts", json={
        "brand_id": bid, "brief_id": brief_id, "copy_id": cid,
        "artifact_type": "carousel", "model_provider_id": stub_provider,
        "variants": 3}).json()
    assert len(rows) == 3
    assert len({r["variant_group_id"] for r in rows}) == 1

def test_variants_are_capped(client_admin, stub_provider):
    bid, brief_id, cid = _ready_copy(client_admin)
    client_admin.post(f"/api/v1/copy/{cid}/approve")
    r = client_admin.post("/api/v1/artifacts", json={
        "brand_id": bid, "brief_id": brief_id, "copy_id": cid,
        "artifact_type": "carousel", "model_provider_id": stub_provider,
        "variants": 99})
    assert r.status_code == 422
```

```python
# backend/tests/test_worker.py
from app.db.models import Artifact, ArtifactStatus, GenerationJob, JobState
from app.workers import queue, generation_worker

def test_run_job_marks_the_artifact_ready(db_session, queued_artifact, fake_open_design):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    artifact = db_session.get(Artifact, queued_artifact)
    assert artifact.status == ArtifactStatus.READY
    assert artifact.open_design_project_ref == "proj_42"
    assert artifact.export_urls == {"png": "http://od/e/1.png"}

def test_a_daemon_failure_leaves_the_artifact_failed_after_retries(
        db_session, queued_artifact, broken_open_design):
    for _ in range(queue.MAX_ATTEMPTS):
        job = queue.claim(db_session)
        generation_worker.run_job(db_session, job)
    artifact = db_session.get(Artifact, queued_artifact)
    assert artifact.status == ArtifactStatus.FAILED

def test_progress_advances_through_named_stages(db_session, queued_artifact,
                                                fake_open_design, progress_log):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert [stage for stage, _ in progress_log] == [
        "syncing_brand", "generating", "qa", "done"]

def test_an_iteration_calls_edit_not_generate(db_session, iterating_artifact,
                                              fake_open_design, call_log):
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert call_log == ["edit"]
```

```python
# add to backend/tests/conftest.py
@pytest.fixture
def stub_provider(db_session):
    from app.db.models import ModelProvider, ProviderType
    from app.core.security import LADDER_ORG_ID
    p = ModelProvider(organization_id=LADDER_ORG_ID, type=ProviderType.CODING_AGENT,
                      name="claude", credential_ref="vault://claude")
    db_session.add(p); db_session.commit()
    return p.id

@pytest.fixture
def stub_image_provider(db_session):
    from app.db.models import ModelProvider, ProviderType
    from app.core.security import LADDER_ORG_ID
    p = ModelProvider(organization_id=LADDER_ORG_ID, type=ProviderType.IMAGE_PROVIDER,
                      name="gpt-image-2", credential_ref="vault://openai")
    db_session.add(p); db_session.commit()
    return p.id

@pytest.fixture
def call_log():
    return []

@pytest.fixture
def fake_open_design(monkeypatch, call_log):
    from app.services import open_design as od
    outcome = od.GenerationOutcome(project_ref="proj_42",
                                   export_urls={"png": "http://od/e/1.png"}, log="ok")
    monkeypatch.setattr(od, "generate", lambda req: (call_log.append("generate"), outcome)[1])
    monkeypatch.setattr(od, "edit", lambda ref, msg: (call_log.append("edit"), outcome)[1])
    return outcome

@pytest.fixture
def broken_open_design(monkeypatch):
    from app.services import open_design as od
    def boom(*_a, **_k):
        raise od.OpenDesignError("daemon down")
    monkeypatch.setattr(od, "generate", boom)
    monkeypatch.setattr(od, "edit", boom)

@pytest.fixture
def progress_log(monkeypatch):
    from app.workers import queue as q
    log = []
    original = q.report_progress
    def spy(db, job_id, stage, percent, detail=""):
        log.append((stage, percent))
        original(db, job_id, stage, percent, detail)
    monkeypatch.setattr(q, "report_progress", spy)
    return log
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_artifacts.py tests/test_worker.py -v`
Expected: FAIL, 404 on `/api/v1/artifacts`

- [ ] **Step 3: Write the schema**

```python
# backend/app/schemas/artifact.py
from datetime import datetime
from pydantic import BaseModel, Field

MAX_VARIANTS = 8

class ArtifactCreate(BaseModel):
    brand_id: str
    brief_id: str
    copy_id: str | None = None
    artifact_type: str
    model_provider_id: str
    variants: int = Field(default=1, ge=1, le=MAX_VARIANTS)

class IterateRequest(BaseModel):
    instruction: str = Field(min_length=1)

class ArtifactOut(BaseModel):
    id: str
    brand_id: str
    brief_id: str
    copy_id: str | None
    artifact_type: str
    generation_mode: str
    model_provider_id: str
    status: str
    version: int
    parent_artifact_id: str | None
    variant_group_id: str | None
    open_design_project_ref: str | None
    export_urls: dict
    qa_report: dict
    created_at: datetime
    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Write the artifacts router**

```python
# backend/app/api/v1/artifacts.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.api.v1.copy import get_approved_copy, get_brief
from app.core.security import current_user
from app.db.session import get_db
from app.db.models import (Artifact, ArtifactStatus, ArtifactType, GenerationMode,
                            ModelProvider, ProviderType, User)
from app.schemas.artifact import ArtifactCreate, ArtifactOut, IterateRequest
from app.workers import queue

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

def mode_for(artifact_type: ArtifactType) -> GenerationMode:
    """PRD 2: only `image` runs image-mode; everything else is code-mode."""
    return GenerationMode.IMAGE if artifact_type == ArtifactType.IMAGE else GenerationMode.CODE

def get_artifact(db: Session, artifact_id: str) -> Artifact:
    artifact = db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    return artifact

@router.post("", response_model=list[ArtifactOut], status_code=status.HTTP_201_CREATED)
def create_artifacts(payload: ArtifactCreate, db: Session = Depends(get_db),
                     user: User = Depends(current_user)):
    get_brand(db, payload.brand_id)
    get_brief(db, payload.brief_id)
    try:
        artifact_type = ArtifactType(payload.artifact_type)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"unknown artifact_type: {payload.artifact_type}") from None
    mode = mode_for(artifact_type)

    provider = db.get(ModelProvider, payload.model_provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "model not available")
    wanted = ProviderType.IMAGE_PROVIDER if mode == GenerationMode.IMAGE else ProviderType.CODING_AGENT
    if provider.type != wanted:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"{artifact_type.value} needs a {wanted.value}")

    if payload.copy_id:
        get_approved_copy(db, payload.copy_id)   # 409 unless approved

    # PRD 5.3: N options from one brief is the real workflow, not an edge case.
    group_id = str(uuid.uuid4()) if payload.variants > 1 else None
    rows = []
    for _ in range(payload.variants):
        artifact = Artifact(
            brand_id=payload.brand_id, brief_id=payload.brief_id,
            copy_id=payload.copy_id, artifact_type=artifact_type,
            generation_mode=mode, model_provider_id=provider.id,
            status=ArtifactStatus.QUEUED, version=1,
            variant_group_id=group_id, created_by=user.id)
        db.add(artifact); rows.append(artifact)
    db.commit()
    for artifact in rows:
        db.refresh(artifact)
        queue.enqueue(db, artifact.id)
    return rows

@router.get("/{artifact_id}", response_model=ArtifactOut)
def read_artifact(artifact_id: str, db: Session = Depends(get_db),
                  _: User = Depends(current_user)):
    return get_artifact(db, artifact_id)

@router.get("", response_model=list[ArtifactOut])
def list_artifacts(brand_id: str, db: Session = Depends(get_db),
                   _: User = Depends(current_user)):
    return db.scalars(
        select(Artifact).where(Artifact.brand_id == brand_id)
        .order_by(Artifact.created_at.desc())
    ).all()

@router.post("/{artifact_id}/iterate", response_model=ArtifactOut,
             status_code=status.HTTP_201_CREATED)
def iterate(artifact_id: str, payload: IterateRequest, db: Session = Depends(get_db),
            user: User = Depends(current_user)):
    """PRD 5.4: every iteration creates a new version; lineage is preserved."""
    parent = get_artifact(db, artifact_id)
    if not parent.open_design_project_ref:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "cannot iterate on an artifact that never generated")
    child = Artifact(
        brand_id=parent.brand_id, brief_id=parent.brief_id, copy_id=parent.copy_id,
        artifact_type=parent.artifact_type, generation_mode=parent.generation_mode,
        model_provider_id=parent.model_provider_id, status=ArtifactStatus.QUEUED,
        version=parent.version + 1, parent_artifact_id=parent.id,
        variant_group_id=parent.variant_group_id,
        open_design_project_ref=parent.open_design_project_ref,
        edit_instruction=payload.instruction, created_by=user.id)
    db.add(child); db.commit(); db.refresh(child)
    queue.enqueue(db, child.id)
    return child
```

- [ ] **Step 5: Write the worker**

```python
# backend/app/workers/generation_worker.py
"""The generation worker process.

One artifact per job. Progress is written to the job row at each stage so a
member who reconnects sees where things are (PRD 7.1). Concurrency is capped by
running N worker containers, where N matches how many open-design daemons exist:
a single daemon serialises, so the default is 1.
"""
from __future__ import annotations
import logging
import time

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.db.models import (Artifact, ArtifactStatus, Brand, GenerationJob,
                            GenerationMode, ModelProvider)
from app.api.v1.contracts import latest_design
from app.services import brand_sync, open_design as od
from app.workers import queue

logger = logging.getLogger(__name__)
POLL_SECONDS = 2

def _build_request(db: Session, artifact: Artifact) -> od.GenerationRequest:
    brand = db.get(Brand, artifact.brand_id)
    design = latest_design(db, artifact.brand_id)
    provider = db.get(ModelProvider, artifact.model_provider_id)
    copy_text = artifact.copy.content if artifact.copy_id and hasattr(artifact, "copy") else ""
    if artifact.copy_id and not copy_text:
        from app.db.models import Copy
        copy_row = db.get(Copy, artifact.copy_id)
        copy_text = copy_row.content if copy_row else ""
    return od.GenerationRequest(
        brand_slug=brand.slug,
        artifact_type=artifact.artifact_type.value,
        mode=artifact.generation_mode.value,
        copy_text=copy_text,
        design_md=design.design_md_content if design else "",
        reference_specs=[],   # filled in by Task 20
        asset_paths=[],       # filled in by Task 20
        skill_paths=[],       # filled in by Task 20
        model_name=provider.name if provider else "",
        variant_index=artifact.version,
    )

def run_job(db: Session, job: GenerationJob) -> None:
    artifact = db.get(Artifact, job.artifact_id)
    if artifact is None:
        queue.fail(db, job.id, "artifact vanished", retryable=False)
        return

    artifact.status = ArtifactStatus.GENERATING
    db.commit()

    try:
        queue.report_progress(db, job.id, "syncing_brand", 10)
        brand = db.get(Brand, artifact.brand_id)
        brand_sync.sync_brand(db, brand)

        queue.report_progress(db, job.id, "generating", 30, "calling open-design")
        if artifact.edit_instruction and artifact.open_design_project_ref:
            outcome = od.edit(artifact.open_design_project_ref, artifact.edit_instruction)
        else:
            outcome = od.generate(_build_request(db, artifact))

        artifact.open_design_project_ref = outcome.project_ref or artifact.open_design_project_ref
        artifact.export_urls = outcome.export_urls
        db.commit()

        queue.report_progress(db, job.id, "qa", 70, "running quality checks")
        _run_qa(db, artifact)   # replaced with the real gate in Task 23

        queue.report_progress(db, job.id, "done", 100)
        queue.succeed(db, job.id)
    except od.OpenDesignError as exc:
        logger.warning("generation failed for %s: %s", artifact.id, exc)
        queue.fail(db, job.id, str(exc), retryable=True)
        db.refresh(job)
        artifact.status = (ArtifactStatus.FAILED
                           if job.state.value == "failed" else ArtifactStatus.QUEUED)
        db.commit()

def _run_qa(db: Session, artifact: Artifact) -> None:
    """Placeholder until Task 23 wires the real gate. Marks the artifact ready."""
    artifact.status = ArtifactStatus.READY
    db.commit()

def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("generation worker up; concurrency cap is %s per daemon",
                settings.MAX_CONCURRENT_GENERATIONS)
    while True:
        with SessionLocal() as db:
            job = queue.claim(db)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            run_job(db, job)

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pytest tests/test_artifacts.py tests/test_worker.py -v`
Expected: all passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/artifact.py backend/app/api/v1/artifacts.py backend/app/workers/generation_worker.py backend/app/api/v1/router.py backend/tests/
git commit -m "feat: artifact creation, variants, iteration lineage and the generation worker"
```

### Task 13: Reconnectable progress stream

**Files:**
- Create: `backend/app/api/v1/jobs.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_jobs_stream.py`

**Interfaces:**
- Consumes: `GenerationJob`, `get_artifact`.
- Produces: `GET /api/v1/artifacts/{artifact_id}/job` (snapshot); `GET /api/v1/artifacts/{artifact_id}/job/stream` (SSE).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_jobs_stream.py
from app.workers import queue

def test_job_snapshot_reflects_persisted_progress(client_admin, db_session, queued_artifact):
    job = queue.claim(db_session)
    queue.report_progress(db_session, job.id, "generating", 42, "calling open-design")
    body = client_admin.get(f"/api/v1/artifacts/{queued_artifact}/job").json()
    assert body["state"] == "running"
    assert body["progress"]["percent"] == 42

def test_snapshot_is_404_when_no_job_exists(client_admin, bare_artifact):
    assert client_admin.get(f"/api/v1/artifacts/{bare_artifact}/job").status_code == 404

def test_stream_emits_at_least_one_event_and_terminates_when_done(
        client_admin, db_session, queued_artifact):
    job = queue.claim(db_session)
    queue.succeed(db_session, job.id)
    with client_admin.stream("GET", f"/api/v1/artifacts/{queued_artifact}/job/stream") as r:
        text = "".join(chunk for chunk in r.iter_text())
    assert "data:" in text
    assert '"stage": "done"' in text or '"stage":"done"' in text
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_jobs_stream.py -v`
Expected: FAIL, 404 on the job routes

- [ ] **Step 3: Write the routes**

SSE over a database poll, not websockets and not Redis pub/sub. Progress already lives in a row, so a reconnecting client just reads it again — which is exactly the reconnectability PRD §7.1 asks for.

```python
# backend/app/api/v1/jobs.py
import asyncio, json
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.artifacts import get_artifact
from app.core.security import current_user
from app.db.session import get_db, SessionLocal
from app.db.models import GenerationJob, JobState, User

router = APIRouter(prefix="/artifacts/{artifact_id}/job", tags=["jobs"])

TERMINAL = {JobState.SUCCEEDED, JobState.FAILED}
POLL_SECONDS = 1.0
MAX_STREAM_SECONDS = 1800

def _latest_job(db: Session, artifact_id: str) -> GenerationJob:
    job = db.scalar(
        select(GenerationJob).where(GenerationJob.artifact_id == artifact_id)
        .order_by(GenerationJob.created_at.desc()).limit(1)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no job for this artifact")
    return job

def _snapshot(job: GenerationJob) -> dict:
    return {"job_id": job.id, "state": job.state, "attempts": job.attempts,
            "progress": job.progress_ref or {}, "error": job.error}

@router.get("")
def job_snapshot(artifact_id: str, db: Session = Depends(get_db),
                 _: User = Depends(current_user)) -> dict:
    get_artifact(db, artifact_id)
    return _snapshot(_latest_job(db, artifact_id))

@router.get("/stream")
def job_stream(artifact_id: str, db: Session = Depends(get_db),
               _: User = Depends(current_user)) -> StreamingResponse:
    get_artifact(db, artifact_id)
    _latest_job(db, artifact_id)   # 404 now rather than inside the stream

    async def events():
        last = None
        elapsed = 0.0
        while elapsed < MAX_STREAM_SECONDS:
            with SessionLocal() as session:
                job = session.scalar(
                    select(GenerationJob).where(GenerationJob.artifact_id == artifact_id)
                    .order_by(GenerationJob.created_at.desc()).limit(1)
                )
                if job is None:
                    break
                payload = _snapshot(job)
                if payload != last:
                    yield f"data: {json.dumps(payload)}\n\n"
                    last = payload
                if job.state in TERMINAL:
                    break
            await asyncio.sleep(POLL_SECONDS)
            elapsed += POLL_SECONDS

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_jobs_stream.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/jobs.py backend/app/api/v1/router.py backend/tests/test_jobs_stream.py
git commit -m "feat: reconnectable SSE progress stream backed by the job row"
```

### Task 14: Exports

**Files:**
- Create: `backend/app/api/v1/export.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_export.py`

**Interfaces:**
- Consumes: `get_artifact`, `od.download_export`, `storage.put`, `storage.signed_url`.
- Produces: `GET /api/v1/artifacts/{artifact_id}/exports` returning `{format: signed_url}`; `GET /api/v1/artifacts/{artifact_id}/exports/{fmt}.zip` for carousels. Also `ALLOWED_FORMATS: dict[ArtifactType, tuple[str, ...]]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_export.py
import zipfile, io

def test_exports_are_signed_not_raw_daemon_urls(client_admin, ready_artifact, fake_storage):
    body = client_admin.get(f"/api/v1/artifacts/{ready_artifact}/exports").json()
    assert "od/e/" not in body["png"]
    assert body["png"].startswith("https://")

def test_unready_artifact_has_no_exports(client_admin, queued_artifact):
    r = client_admin.get(f"/api/v1/artifacts/{queued_artifact}/exports")
    assert r.status_code == 409

def test_deck_rejects_a_png_export(client_admin, ready_deck):
    r = client_admin.get(f"/api/v1/artifacts/{ready_deck}/exports/png.zip")
    assert r.status_code == 422

def test_carousel_zip_contains_one_png_per_card(client_admin, ready_carousel, fake_storage):
    r = client_admin.get(f"/api/v1/artifacts/{ready_carousel}/exports/png.zip")
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert len(names) == 3
    assert all(n.endswith(".png") for n in names)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_export.py -v`
Expected: FAIL, 404 on the exports routes

- [ ] **Step 3: Write the router**

Exports are pulled from open-design once, cached into Storage, and served as signed URLs. That keeps the daemon off the public internet and gives revocable links.

```python
# backend/app/api/v1/export.py
import io, zipfile
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.v1.artifacts import get_artifact
from app.core.security import current_user
from app.db.session import get_db
from app.db.models import Artifact, ArtifactStatus, ArtifactType, Brand, User
from app.services import open_design as od, storage

router = APIRouter(prefix="/artifacts/{artifact_id}/exports", tags=["exports"])

# PRD 2 scope table. Nothing outside this map is exportable.
ALLOWED_FORMATS: dict[ArtifactType, tuple[str, ...]] = {
    ArtifactType.SOCIAL_POST: ("png",),
    ArtifactType.CAROUSEL: ("png",),
    ArtifactType.DECK: ("pptx", "pdf"),
    ArtifactType.SINGLE_PAGER: ("pdf", "html"),
    ArtifactType.IMAGE: ("png", "jpg"),
}

EXPORTABLE_STATUSES = {ArtifactStatus.READY, ArtifactStatus.IN_REVIEW,
                        ArtifactStatus.APPROVED}

def _require_exportable(artifact: Artifact) -> None:
    if artifact.status not in EXPORTABLE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"artifact is {artifact.status}, nothing to export")

def _cache(db: Session, artifact: Artifact, fmt: str, url: str) -> str:
    brand = db.get(Brand, artifact.brand_id)
    key = storage.key_for(brand.slug, "exports", f"{artifact.id}-{artifact.version}.{fmt}")
    storage.put(key, od.download_export(url), "application/octet-stream")
    return storage.signed_url(key)

@router.get("")
def list_exports(artifact_id: str, db: Session = Depends(get_db),
                 _: User = Depends(current_user)) -> dict[str, str]:
    artifact = get_artifact(db, artifact_id)
    _require_exportable(artifact)
    allowed = ALLOWED_FORMATS[artifact.artifact_type]
    return {fmt: _cache(db, artifact, fmt, url)
            for fmt, url in (artifact.export_urls or {}).items() if fmt in allowed}

@router.get("/{fmt}.zip")
def zip_export(artifact_id: str, fmt: str, db: Session = Depends(get_db),
               _: User = Depends(current_user)) -> Response:
    """PRD 2: a carousel ships as one PNG per card in a ZIP."""
    artifact = get_artifact(db, artifact_id)
    _require_exportable(artifact)
    if artifact.artifact_type != ArtifactType.CAROUSEL or fmt != "png":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "zip export is carousel png only")
    cards = (artifact.export_urls or {}).get("cards") or []
    if not cards:
        raise HTTPException(status.HTTP_409_CONFLICT, "no card exports on this artifact")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, url in enumerate(cards, start=1):
            archive.writestr(f"card-{index:02d}.png", od.download_export(url))
    return Response(buffer.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition":
                             f'attachment; filename="carousel-{artifact.id}.zip"'})
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_export.py -v`
Expected: 4 passed

- [ ] **Step 5: Verify Phase 1 end to end**

```bash
docker compose up -d
# then, with a real Supabase token:
curl -H "Authorization: Bearer $TOKEN" -X POST localhost:8000/api/v1/brands -d '{"name":"Ladder"}'
# ... put design + voice, create brief, create copy, approve, create artifact
curl -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/artifacts/$ID/job/stream
```

Expected: the stream reports `syncing_brand → generating → qa → done`, and `GET .../exports` returns a signed URL that downloads a real file.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/export.py backend/app/api/v1/router.py backend/tests/test_export.py
git commit -m "feat: cached, signed exports with per-type format allowlist"
```

---

## Phase 2 — Brand governance

### Task 15: Asset library, with fonts as P0

**Files:**
- Create: `backend/app/schemas/asset.py`
- Create: `backend/app/api/v1/assets.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_assets.py`

**Interfaces:**
- Consumes: `storage.put/delete/signed_url`, `get_brand`, `require_admin`, `brand_sync.sync_brand`.
- Produces: `POST|GET /api/v1/brands/{brand_id}/assets`, `DELETE /api/v1/assets/{asset_id}`. Also `FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_assets.py
def _brand(client_admin):
    return client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]

def test_admin_uploads_a_logo(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = client_admin.post(f"/api/v1/brands/{bid}/assets",
                          data={"asset_type": "logo", "label": "Primary"},
                          files={"file": ("logo.svg", b"<svg/>", "image/svg+xml")})
    assert r.status_code == 201
    assert r.json()["asset_type"] == "logo"

def test_font_upload_rejects_a_non_font_extension(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = client_admin.post(f"/api/v1/brands/{bid}/assets",
                          data={"asset_type": "font", "label": "Inter"},
                          files={"file": ("inter.png", b"x", "image/png")})
    assert r.status_code == 422
    assert "font file" in r.json()["detail"]

def test_font_upload_lands_on_the_shared_volume(client_admin, fake_storage,
                                                tmp_shared_volume):
    bid = _brand(client_admin)
    client_admin.post(f"/api/v1/brands/{bid}/assets",
                      data={"asset_type": "font", "label": "Inter"},
                      files={"file": ("Inter.ttf", b"FONT", "font/ttf")})
    fonts = list((tmp_shared_volume / "design-systems" / "ladder" / "fonts").iterdir())
    assert [p.name.endswith("Inter.ttf") for p in fonts] == [True]

def test_member_cannot_upload_an_asset(client_member, client_admin, fake_storage):
    bid = _brand(client_admin)
    r = client_member.post(f"/api/v1/brands/{bid}/assets",
                           data={"asset_type": "logo", "label": "x"},
                           files={"file": ("l.svg", b"<svg/>", "image/svg+xml")})
    assert r.status_code == 403

def test_oversized_upload_is_rejected(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = client_admin.post(f"/api/v1/brands/{bid}/assets",
                          data={"asset_type": "logo", "label": "big"},
                          files={"file": ("l.png", b"x" * (26 * 1024 * 1024), "image/png")})
    assert r.status_code == 413
```

```python
# add to backend/tests/conftest.py
@pytest.fixture
def tmp_shared_volume(tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHARED_VOLUME_ROOT", str(tmp_path))
    return tmp_path
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_assets.py -v`
Expected: FAIL, 404 on the assets route

- [ ] **Step 3: Write the schema and router**

```python
# backend/app/schemas/asset.py
from datetime import datetime
from pydantic import BaseModel

class AssetOut(BaseModel):
    id: str
    brand_id: str
    asset_type: str
    file_ref: str
    label: str
    url: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}
```

```python
# backend/app/api/v1/assets.py
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user, require_admin
from app.db.session import get_db
from app.db.models import Brand, BrandAsset, AssetType, User
from app.schemas.asset import AssetOut
from app.services import brand_sync, storage

router = APIRouter(tags=["assets"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}

@router.post("/brands/{brand_id}/assets", response_model=AssetOut,
             status_code=status.HTTP_201_CREATED)
async def upload_asset(brand_id: str, asset_type: str = Form(...), label: str = Form(...),
                       file: UploadFile = File(...), db: Session = Depends(get_db),
                       _: User = Depends(require_admin)):
    brand = get_brand(db, brand_id)
    try:
        kind = AssetType(asset_type)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"unknown asset_type: {asset_type}") from None

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"file exceeds {MAX_UPLOAD_BYTES} bytes")

    # PRD 4.4: fonts are P0. A .png named as a font would silently fall back at
    # render time, which is exactly the failure this check exists to prevent.
    if kind == AssetType.FONT and Path(file.filename).suffix.lower() not in FONT_EXTENSIONS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"font file must be one of {sorted(FONT_EXTENSIONS)}")

    key = storage.key_for(brand.slug, "assets", file.filename)
    storage.put(key, data, file.content_type or "application/octet-stream")
    asset = BrandAsset(brand_id=brand.id, asset_type=kind, file_ref=key, label=label)
    db.add(asset); db.commit(); db.refresh(asset)

    # Fonts must exist in the container before the next generation, not after.
    brand_sync.sync_brand(db, brand)
    return asset

@router.get("/brands/{brand_id}/assets", response_model=list[AssetOut])
def list_assets(brand_id: str, db: Session = Depends(get_db),
                _: User = Depends(current_user)):
    get_brand(db, brand_id)
    rows = db.scalars(select(BrandAsset).where(BrandAsset.brand_id == brand_id)).all()
    return [AssetOut.model_validate(r).model_copy(
                update={"url": storage.signed_url(r.file_ref)}) for r in rows]

@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: str, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)) -> None:
    asset = db.get(BrandAsset, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset not found")
    storage.delete(asset.file_ref)
    brand = db.get(Brand, asset.brand_id)
    db.delete(asset); db.commit()
    brand_sync.sync_brand(db, brand)
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_assets.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/asset.py backend/app/api/v1/assets.py backend/app/api/v1/router.py backend/tests/test_assets.py
git commit -m "feat: asset library with font validation and container-side font install"
```

### Task 16: PPTX layout extraction

A `.pptx` is a ZIP of XML with machine-readable geometry. Extracting it beats an agent eyeballing a screenshot. (PRD §4.3)

**Files:**
- Create: `backend/app/services/pptx_extract.py`
- Test: `backend/tests/test_pptx_extract.py`
- Test fixture: `backend/tests/fixtures/two_slide.pptx`

**Interfaces:**
- Produces: `extract_layout_spec(data: bytes) -> str`; `PptxParseError`.

- [ ] **Step 1: Build the fixture**

```python
# backend/tests/fixtures/build_fixture.py  (run once, commit the .pptx)
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "Ladder"
box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(1))
box.text_frame.text = "Body copy"
box.text_frame.paragraphs[0].runs[0].font.size = Pt(18)
prs.slides.add_slide(prs.slide_layouts[6])
prs.save("backend/tests/fixtures/two_slide.pptx")
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_pptx_extract.py
import pytest
from pathlib import Path
from app.services import pptx_extract

FIXTURE = Path(__file__).parent / "fixtures" / "two_slide.pptx"

def test_spec_reports_the_slide_size():
    spec = pptx_extract.extract_layout_spec(FIXTURE.read_bytes())
    assert "slide_size:" in spec
    assert "13.33x7.50in" in spec or "10.00x7.50in" in spec

def test_spec_lists_every_slide_with_its_layout_name():
    spec = pptx_extract.extract_layout_spec(FIXTURE.read_bytes())
    assert spec.count("## slide ") == 2
    assert "layout:" in spec

def test_spec_reports_shape_geometry_in_inches():
    spec = pptx_extract.extract_layout_spec(FIXTURE.read_bytes())
    assert "at 1.00,2.00 size 4.00x1.00in" in spec

def test_spec_reports_font_size_when_present():
    spec = pptx_extract.extract_layout_spec(FIXTURE.read_bytes())
    assert "18.0pt" in spec

def test_a_corrupt_file_raises_a_typed_error():
    with pytest.raises(pptx_extract.PptxParseError):
        pptx_extract.extract_layout_spec(b"not a pptx")

def test_spec_is_bounded_for_a_huge_deck():
    spec = pptx_extract.extract_layout_spec(FIXTURE.read_bytes())
    assert len(spec) < pptx_extract.MAX_SPEC_CHARS
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pytest tests/test_pptx_extract.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.pptx_extract'`

- [ ] **Step 4: Write the extractor**

```python
# backend/app/services/pptx_extract.py
"""Turn a .pptx reference into a text layout spec.

PRD 4.3: a .pptx carries machine-readable geometry — shape positions, sizes,
fonts, colours, master layouts. Extracting it is meaningfully higher fidelity
than an agent eyeballing a screenshot, and open-design exports PPTX but shows
no sign of ingesting one, so this is Content Studio's job.
"""
from __future__ import annotations
import io

from pptx import Presentation
from pptx.util import Emu

# The spec is pasted into a generation prompt. A 200-slide deck would otherwise
# consume the context window it is meant to inform.
MAX_SPEC_CHARS = 20_000
MAX_SLIDES = 40
MAX_SHAPES_PER_SLIDE = 30

class PptxParseError(ValueError):
    """The file is not a readable presentation."""

def _inches(value) -> float:
    return round(Emu(value or 0).inches, 2)

def _font_note(shape) -> str:
    if not getattr(shape, "has_text_frame", False):
        return ""
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            bits = []
            if run.font.size:
                bits.append(f"{run.font.size.pt}pt")
            if run.font.name:
                bits.append(run.font.name)
            if run.font.bold:
                bits.append("bold")
            if bits:
                return " " + " ".join(bits)
    return ""

def extract_layout_spec(data: bytes) -> str:
    try:
        prs = Presentation(io.BytesIO(data))
    except Exception as exc:
        raise PptxParseError(f"unreadable pptx: {exc}") from exc

    lines = [f"slide_size: {_inches(prs.slide_width):.2f}x{_inches(prs.slide_height):.2f}in"]
    for index, slide in enumerate(prs.slides, start=1):
        if index > MAX_SLIDES:
            lines.append(f"\n(truncated after {MAX_SLIDES} slides)")
            break
        lines.append(f"\n## slide {index} (layout: {slide.slide_layout.name})")
        for count, shape in enumerate(slide.shapes, start=1):
            if count > MAX_SHAPES_PER_SLIDE:
                lines.append(f"- (truncated after {MAX_SHAPES_PER_SLIDE} shapes)")
                break
            text = ""
            if getattr(shape, "has_text_frame", False):
                text = " ".join(shape.text_frame.text.split())[:80]
            lines.append(
                f"- {shape.shape_type} at {_inches(shape.left):.2f},{_inches(shape.top):.2f} "
                f"size {_inches(shape.width):.2f}x{_inches(shape.height):.2f}in"
                f"{_font_note(shape)}"
                + (f' text="{text}"' if text else "")
            )
    spec = "\n".join(lines)
    return spec[:MAX_SPEC_CHARS]
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_pptx_extract.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/pptx_extract.py backend/tests/test_pptx_extract.py backend/tests/fixtures/
git commit -m "feat: pptx geometry extraction into a bounded text layout spec"
```

### Task 17: Reference library with scope and role tagging

**Files:**
- Create: `backend/app/schemas/reference.py`
- Create: `backend/app/api/v1/references.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_references.py`

**Interfaces:**
- Consumes: `extract_layout_spec` (Task 16), `storage`, `get_brand`, `require_admin`.
- Produces: `POST|GET /api/v1/brands/{brand_id}/references`, `DELETE /api/v1/references/{reference_id}`. Also `references_for(db, brand_id, artifact_type) -> list[BrandReference]` and `SCOPE_FOR_TYPE: dict[ArtifactType, ReferenceScope]` — Task 20 depends on both.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_references.py
from pathlib import Path
from app.api.v1.references import references_for
from app.db.models import ArtifactType

FIXTURE = Path(__file__).parent / "fixtures" / "two_slide.pptx"

def _brand(client_admin):
    return client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]

def _upload(client, bid, filename, data, scope, role, mime="image/png"):
    return client.post(f"/api/v1/brands/{bid}/references",
                       data={"scope": scope, "role": role},
                       files={"file": (filename, data, mime)})

def test_image_reference_has_no_layout_spec(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = _upload(client_admin, bid, "ref.png", b"\x89PNG", "social", "layout")
    assert r.status_code == 201
    assert r.json()["file_type"] == "image"
    assert r.json()["extracted_layout_spec"] is None

def test_pptx_reference_is_parsed_at_upload_time(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = _upload(client_admin, bid, "deck.pptx", FIXTURE.read_bytes(),
                "presentation", "layout",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    assert r.json()["file_type"] == "pptx"
    assert "slide_size:" in r.json()["extracted_layout_spec"]

def test_a_corrupt_pptx_is_rejected_at_upload(client_admin, fake_storage):
    bid = _brand(client_admin)
    r = _upload(client_admin, bid, "bad.pptx", b"junk", "presentation", "layout",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    assert r.status_code == 422

def test_an_unknown_role_is_rejected(client_admin, fake_storage):
    bid = _brand(client_admin)
    assert _upload(client_admin, bid, "r.png", b"x", "social", "mood").status_code == 422

def test_social_generation_never_sees_presentation_references(client_admin,
                                                              db_session, fake_storage):
    bid = _brand(client_admin)
    _upload(client_admin, bid, "s.png", b"x", "social", "layout")
    _upload(client_admin, bid, "p.png", b"x", "presentation", "layout")
    _upload(client_admin, bid, "b.png", b"x", "both", "overall_vibe")
    scopes = {r.scope for r in references_for(db_session, bid, ArtifactType.CAROUSEL)}
    assert scopes == {"social", "both"}

def test_deck_generation_never_sees_social_references(client_admin, db_session, fake_storage):
    bid = _brand(client_admin)
    _upload(client_admin, bid, "s.png", b"x", "social", "layout")
    _upload(client_admin, bid, "p.png", b"x", "presentation", "layout")
    scopes = {r.scope for r in references_for(db_session, bid, ArtifactType.DECK)}
    assert scopes == {"presentation"}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_references.py -v`
Expected: FAIL, 404 on the references route

- [ ] **Step 3: Write the schema and router**

```python
# backend/app/schemas/reference.py
from datetime import datetime
from pydantic import BaseModel

class ReferenceOut(BaseModel):
    id: str
    brand_id: str
    file_ref: str
    file_type: str
    scope: str
    role: str
    extracted_layout_spec: str | None
    url: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}
```

```python
# backend/app/api/v1/references.py
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.brands import get_brand
from app.core.security import current_user, require_admin
from app.db.session import get_db
from app.db.models import (ArtifactType, BrandReference, ReferenceRole,
                            ReferenceScope, User)
from app.schemas.reference import ReferenceOut
from app.services import pptx_extract, storage

router = APIRouter(tags=["references"])

MAX_REFERENCE_BYTES = 25 * 1024 * 1024

# PRD 4.3: this map is what lets a social vibe and a presentation vibe coexist
# on one brand without bleeding into each other.
SCOPE_FOR_TYPE: dict[ArtifactType, ReferenceScope] = {
    ArtifactType.SOCIAL_POST: ReferenceScope.SOCIAL,
    ArtifactType.CAROUSEL: ReferenceScope.SOCIAL,
    ArtifactType.IMAGE: ReferenceScope.SOCIAL,
    ArtifactType.DECK: ReferenceScope.PRESENTATION,
    ArtifactType.SINGLE_PAGER: ReferenceScope.PRESENTATION,
}

def references_for(db: Session, brand_id: str,
                   artifact_type: ArtifactType) -> list[BrandReference]:
    wanted = SCOPE_FOR_TYPE[artifact_type]
    return list(db.scalars(
        select(BrandReference).where(
            BrandReference.brand_id == brand_id,
            BrandReference.scope.in_([wanted, ReferenceScope.BOTH]),
        )
    ).all())

@router.post("/brands/{brand_id}/references", response_model=ReferenceOut,
             status_code=status.HTTP_201_CREATED)
async def upload_reference(brand_id: str, scope: str = Form(...), role: str = Form(...),
                           file: UploadFile = File(...), db: Session = Depends(get_db),
                           _: User = Depends(require_admin)):
    brand = get_brand(db, brand_id)
    try:
        scope_value, role_value = ReferenceScope(scope), ReferenceRole(role)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None

    data = await file.read()
    if len(data) > MAX_REFERENCE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "reference too large")

    is_pptx = Path(file.filename).suffix.lower() == ".pptx"
    spec = None
    if is_pptx:
        try:
            spec = pptx_extract.extract_layout_spec(data)
        except pptx_extract.PptxParseError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None

    key = storage.key_for(brand.slug, "references", file.filename)
    storage.put(key, data, file.content_type or "application/octet-stream")
    row = BrandReference(brand_id=brand.id, file_ref=key,
                         file_type="pptx" if is_pptx else "image",
                         scope=scope_value, role=role_value,
                         extracted_layout_spec=spec)
    db.add(row); db.commit(); db.refresh(row)
    return row

@router.get("/brands/{brand_id}/references", response_model=list[ReferenceOut])
def list_references(brand_id: str, db: Session = Depends(get_db),
                    _: User = Depends(current_user)):
    get_brand(db, brand_id)
    rows = db.scalars(
        select(BrandReference).where(BrandReference.brand_id == brand_id)).all()
    return [ReferenceOut.model_validate(r).model_copy(
                update={"url": storage.signed_url(r.file_ref)}) for r in rows]

@router.delete("/references/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reference(reference_id: str, db: Session = Depends(get_db),
                     _: User = Depends(require_admin)) -> None:
    row = db.get(BrandReference, reference_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "reference not found")
    storage.delete(row.file_ref)
    db.delete(row); db.commit()
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_references.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/reference.py backend/app/api/v1/references.py backend/app/api/v1/router.py backend/tests/test_references.py
git commit -m "feat: tagged reference library with scope filtering and pptx parsing"
```

### Task 18: Model providers with encrypted credentials

**Files:**
- Create: `backend/app/core/crypto.py`
- Create: `backend/app/schemas/provider.py`
- Create: `backend/app/api/v1/providers.py`
- Modify: `backend/app/core/config.py` (add `CREDENTIAL_KEY: str`)
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_providers.py`

**Interfaces:**
- Produces: `encrypt(plaintext: str) -> str`, `decrypt(token: str) -> str`; `POST|GET|PATCH|DELETE /api/v1/providers`; `credential_for(db, provider_id) -> str`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_providers.py
import pytest
from app.core import crypto

def test_credentials_round_trip():
    assert crypto.decrypt(crypto.encrypt("sk-secret")) == "sk-secret"

def test_ciphertext_is_not_the_plaintext():
    assert "sk-secret" not in crypto.encrypt("sk-secret")

def test_creating_a_provider_never_echoes_the_key(client_admin):
    r = client_admin.post("/api/v1/providers", json={
        "type": "coding_agent", "name": "claude", "api_key": "sk-secret"})
    assert r.status_code == 201
    assert "sk-secret" not in r.text
    assert "api_key" not in r.json()

def test_listing_providers_never_echoes_the_key(client_admin):
    client_admin.post("/api/v1/providers", json={
        "type": "image_provider", "name": "gpt-image-2", "api_key": "sk-x"})
    assert "sk-x" not in client_admin.get("/api/v1/providers").text

def test_members_see_only_enabled_providers(client_admin, client_member):
    client_admin.post("/api/v1/providers", json={
        "type": "coding_agent", "name": "on", "api_key": "k"})
    pid = client_admin.post("/api/v1/providers", json={
        "type": "coding_agent", "name": "off", "api_key": "k"}).json()["id"]
    client_admin.patch(f"/api/v1/providers/{pid}", json={"enabled": False})
    assert [p["name"] for p in client_member.get("/api/v1/providers").json()] == ["on"]

def test_member_cannot_create_a_provider(client_member):
    r = client_member.post("/api/v1/providers", json={
        "type": "coding_agent", "name": "x", "api_key": "k"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_providers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.crypto'`

- [ ] **Step 3: Write the crypto module**

Fernet ships with `cryptography`, already pulled in by `pyjwt[crypto]`. Nothing new to install and nothing hand-rolled.

```python
# backend/app/core/crypto.py
"""Symmetric encryption for BYOK provider credentials.

PRD 8 stores a `credential_ref`, never a raw key. Fernet gives authenticated
encryption from a dependency already present, so there is no bespoke crypto and
no extra service. Rotating CREDENTIAL_KEY means re-entering the keys.
"""
from functools import lru_cache
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings

@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    return Fernet(settings.CREDENTIAL_KEY.encode())

def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()

def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("credential could not be decrypted; was CREDENTIAL_KEY rotated?") from exc
```

Add to `config.py`:

```python
    # Generate once: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    CREDENTIAL_KEY: str
```

- [ ] **Step 4: Write the schema and router**

```python
# backend/app/schemas/provider.py
from datetime import datetime
from pydantic import BaseModel, Field

class ProviderCreate(BaseModel):
    type: str
    name: str = Field(min_length=1, max_length=120)
    api_key: str = Field(min_length=1)

class ProviderUpdate(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None

class ProviderOut(BaseModel):
    id: str
    type: str
    name: str
    enabled: bool
    created_at: datetime
    model_config = {"from_attributes": True}   # no api_key field, ever
```

```python
# backend/app/api/v1/providers.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import encrypt, decrypt
from app.core.security import current_user, require_admin, LADDER_ORG_ID
from app.db.session import get_db
from app.db.models import ModelProvider, ProviderType, Role, User
from app.schemas.provider import ProviderCreate, ProviderUpdate, ProviderOut

router = APIRouter(prefix="/providers", tags=["providers"])

def credential_for(db: Session, provider_id: str) -> str:
    provider = db.get(ModelProvider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    return decrypt(provider.credential_ref)

@router.post("", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(payload: ProviderCreate, db: Session = Depends(get_db),
                    _: User = Depends(require_admin)):
    try:
        kind = ProviderType(payload.type)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"unknown provider type: {payload.type}") from None
    provider = ModelProvider(organization_id=LADDER_ORG_ID, type=kind, name=payload.name,
                             credential_ref=encrypt(payload.api_key), enabled=True)
    db.add(provider); db.commit(); db.refresh(provider)
    return provider

@router.get("", response_model=list[ProviderOut])
def list_providers(db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = select(ModelProvider).order_by(ModelProvider.name)
    if user.role != Role.ADMIN:
        # PRD 5.3: members select from what admin has enabled.
        query = query.where(ModelProvider.enabled.is_(True))
    return db.scalars(query).all()

@router.patch("/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: str, payload: ProviderUpdate,
                    db: Session = Depends(get_db), _: User = Depends(require_admin)):
    provider = db.get(ModelProvider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    if payload.enabled is not None:
        provider.enabled = payload.enabled
    if payload.api_key:
        provider.credential_ref = encrypt(payload.api_key)
    db.commit(); db.refresh(provider)
    return provider

@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(provider_id: str, db: Session = Depends(get_db),
                    _: User = Depends(require_admin)) -> None:
    provider = db.get(ModelProvider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    db.delete(provider); db.commit()
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_providers.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/crypto.py backend/app/schemas/provider.py backend/app/api/v1/providers.py backend/app/core/config.py backend/app/api/v1/router.py backend/tests/test_providers.py
git commit -m "feat: model providers with fernet-encrypted byok credentials"
```

### Task 19: Skills, with `image` forbidden at the API boundary

**Files:**
- Create: `backend/app/schemas/skill.py`
- Create: `backend/app/api/v1/skills.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_skills.py`

**Interfaces:**
- Consumes: `Skill` (whose `@validates` already rejects `image`), `storage`.
- Produces: `POST|GET /api/v1/skills`, `PATCH|DELETE /api/v1/skills/{skill_id}`. Also `skills_for(db, artifact_type) -> list[Skill]` — Task 20 depends on it.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_skills.py
from app.api.v1.skills import skills_for
from app.db.models import ArtifactType

def _upload(client, applies_to, name="hallmark"):
    return client.post("/api/v1/skills",
                       data={"name": name, "applies_to": ",".join(applies_to)},
                       files={"file": ("SKILL.md", b"# rules", "text/markdown")})

def test_a_skill_scoped_to_image_is_refused(client_admin, fake_storage):
    r = _upload(client_admin, ["image"])
    assert r.status_code == 422
    assert "image" in r.json()["detail"]

def test_a_mixed_scope_containing_image_is_refused(client_admin, fake_storage):
    r = _upload(client_admin, ["social_post", "image"])
    assert r.status_code == 422

def test_a_valid_scope_is_accepted(client_admin, fake_storage):
    r = _upload(client_admin, ["social_post", "single_pager"])
    assert r.status_code == 201
    assert r.json()["applies_to"] == ["social_post", "single_pager"]

def test_an_unknown_artifact_type_is_refused(client_admin, fake_storage):
    assert _upload(client_admin, ["contract"]).status_code == 422

def test_skills_are_selected_by_artifact_type(client_admin, db_session, fake_storage):
    _upload(client_admin, ["single_pager"], name="hallmark")
    _upload(client_admin, ["deck"], name="deckrules")
    names = [s.name for s in skills_for(db_session, ArtifactType.SINGLE_PAGER)]
    assert names == ["hallmark"]

def test_disabled_skills_are_not_selected(client_admin, db_session, fake_storage):
    sid = _upload(client_admin, ["deck"], name="deckrules").json()["id"]
    client_admin.patch(f"/api/v1/skills/{sid}", json={"enabled": False})
    assert skills_for(db_session, ArtifactType.DECK) == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_skills.py -v`
Expected: FAIL, 404 on `/api/v1/skills`

- [ ] **Step 3: Write the schema and router**

```python
# backend/app/schemas/skill.py
from datetime import datetime
from pydantic import BaseModel

class SkillUpdate(BaseModel):
    enabled: bool

class SkillOut(BaseModel):
    id: str
    name: str
    storage_ref: str
    applies_to: list[str]
    enabled: bool
    created_at: datetime
    model_config = {"from_attributes": True}
```

```python
# backend/app/api/v1/skills.py
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import current_user, require_admin, LADDER_ORG_ID
from app.db.session import get_db
from app.db.models import ArtifactType, Skill, User
from app.schemas.skill import SkillOut, SkillUpdate
from app.services import storage

router = APIRouter(prefix="/skills", tags=["skills"])

def skills_for(db: Session, artifact_type: ArtifactType) -> list[Skill]:
    """PRD 6.4: image-mode has no coding agent, so no skill can ever match it.
    The Skill model refuses to store `image`, so this needs no special case."""
    rows = db.scalars(select(Skill).where(Skill.enabled.is_(True))).all()
    return [s for s in rows if artifact_type.value in (s.applies_to or [])]

@router.post("", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
async def upload_skill(name: str = Form(...), applies_to: str = Form(...),
                       file: UploadFile = File(...), db: Session = Depends(get_db),
                       admin: User = Depends(require_admin)):
    types = [t.strip() for t in applies_to.split(",") if t.strip()]
    key = storage.key_for("_skills", name.replace("/", "-"), "SKILL.md")
    data = await file.read()
    storage.put(key, data, "text/markdown")
    try:
        # The model's @validates raises for `image` and for unknown types.
        skill = Skill(organization_id=LADDER_ORG_ID, name=name, uploaded_by=admin.id,
                      storage_ref=key, applies_to=types, enabled=True)
    except ValueError as exc:
        storage.delete(key)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None
    db.add(skill); db.commit(); db.refresh(skill)
    return skill

@router.get("", response_model=list[SkillOut])
def list_skills(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return db.scalars(select(Skill).order_by(Skill.name)).all()

@router.patch("/{skill_id}", response_model=SkillOut)
def update_skill(skill_id: str, payload: SkillUpdate, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)):
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "skill not found")
    skill.enabled = payload.enabled
    db.commit(); db.refresh(skill)
    return skill

@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: str, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)) -> None:
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "skill not found")
    storage.delete(skill.storage_ref)
    db.delete(skill); db.commit()
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_skills.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/skill.py backend/app/api/v1/skills.py backend/app/api/v1/router.py backend/tests/test_skills.py
git commit -m "feat: skill upload with image scope refused at the api boundary"
```

### Task 20: Wire references, assets and skills into the generation payload

Fills the three `# filled in by Task 20` gaps left in `generation_worker._build_request`.

**Files:**
- Modify: `backend/app/workers/generation_worker.py`
- Test: `backend/tests/test_generation_payload.py`

**Interfaces:**
- Consumes: `references_for`, `SCOPE_FOR_TYPE` (Task 17), `skills_for` (Task 19), `brand_sync.brand_root` (Task 7), `credential_for` (Task 18).
- Produces: no new names — `_build_request` now returns a fully populated `GenerationRequest`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_generation_payload.py
from app.workers.generation_worker import _build_request
from app.db.models import Artifact, ArtifactType

def test_payload_carries_pptx_layout_specs(db_session, deck_artifact_with_pptx_ref):
    req = _build_request(db_session, deck_artifact_with_pptx_ref)
    assert any("slide_size:" in spec for spec in req.reference_specs)

def test_payload_excludes_out_of_scope_references(db_session, carousel_with_mixed_refs):
    req = _build_request(db_session, carousel_with_mixed_refs)
    assert not any("presentation-only" in spec for spec in req.reference_specs)

def test_payload_carries_asset_paths_on_the_shared_volume(db_session, artifact_with_logo,
                                                          tmp_shared_volume):
    req = _build_request(db_session, artifact_with_logo)
    assert req.asset_paths
    assert all(p.startswith(str(tmp_shared_volume)) for p in req.asset_paths)

def test_payload_carries_only_matching_skills(db_session, single_pager_with_skills):
    req = _build_request(db_session, single_pager_with_skills)
    assert [p.split("/")[-2] for p in req.skill_paths] == ["hallmark"]

def test_image_mode_payload_carries_no_skills(db_session, image_artifact_with_skills):
    req = _build_request(db_session, image_artifact_with_skills)
    assert req.skill_paths == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_generation_payload.py -v`
Expected: FAIL — `reference_specs`, `asset_paths` and `skill_paths` are all empty

- [ ] **Step 3: Rewrite `_build_request`**

```python
# backend/app/workers/generation_worker.py  (replace _build_request)
def _reference_specs(db: Session, artifact: Artifact, brand: Brand) -> list[str]:
    """PRD 4.3: only references matching the artifact type's scope are included."""
    from app.api.v1.references import references_for
    specs = []
    for ref in references_for(db, artifact.brand_id, artifact.artifact_type):
        if ref.extracted_layout_spec:
            # Higher fidelity than an agent eyeballing the same file.
            specs.append(f"[{ref.role} / {ref.scope}]\n{ref.extracted_layout_spec}")
        else:
            local = brand_sync.brand_root(brand.slug) / "references" / ref.file_ref.rsplit("/", 1)[-1]
            specs.append(f"[{ref.role} / {ref.scope}] image: {local}")
    return specs

def _asset_paths(db: Session, artifact: Artifact, brand: Brand) -> list[str]:
    """PRD 4.4: generated artifacts inject real assets. An AI-approximated logo
    is never acceptable output, so paths point at real files on the volume."""
    from app.db.models import BrandAsset, AssetType
    from sqlalchemy import select
    root = brand_sync.brand_root(brand.slug)
    paths = []
    for asset in db.scalars(select(BrandAsset).where(BrandAsset.brand_id == brand.id)).all():
        filename = asset.file_ref.rsplit("/", 1)[-1]
        directory = "fonts" if asset.asset_type == AssetType.FONT else "assets"
        paths.append(str(root / directory / filename))
    return paths

def _skill_paths(db: Session, artifact: Artifact) -> list[str]:
    """PRD 6.4: image-mode has no coding agent to instruct, so it gets no skills.
    `skills_for` cannot return an image-scoped skill, but the mode check makes
    the rule readable at the call site rather than implied two files away."""
    if artifact.generation_mode == GenerationMode.IMAGE:
        return []
    from app.api.v1.skills import skills_for
    from app.core.config import settings as cfg
    return [f"{cfg.SHARED_VOLUME_ROOT}/skills/{s.name}/SKILL.md"
            for s in skills_for(db, artifact.artifact_type)]

def _build_request(db: Session, artifact: Artifact) -> od.GenerationRequest:
    from app.db.models import Copy
    brand = db.get(Brand, artifact.brand_id)
    design = latest_design(db, artifact.brand_id)
    provider = db.get(ModelProvider, artifact.model_provider_id)
    copy_row = db.get(Copy, artifact.copy_id) if artifact.copy_id else None
    return od.GenerationRequest(
        brand_slug=brand.slug,
        artifact_type=artifact.artifact_type.value,
        mode=artifact.generation_mode.value,
        copy_text=copy_row.content if copy_row else "",
        design_md=design.design_md_content if design else "",
        reference_specs=_reference_specs(db, artifact, brand),
        asset_paths=_asset_paths(db, artifact, brand),
        skill_paths=_skill_paths(db, artifact),
        model_name=provider.name if provider else "",
        variant_index=artifact.version,
    )
```

- [ ] **Step 4: Sync references and skills to the volume too**

In `brand_sync.sync_brand`, after the asset loop, add:

```python
    from app.db.models import BrandReference
    for ref in db.scalars(select(BrandReference).where(BrandReference.brand_id == brand.id)).all():
        if ref.file_type == "image":
            filename = ref.file_ref.rsplit("/", 1)[-1]
            _write_if_changed(root / "references" / filename, storage.get(ref.file_ref))
```

And add a module-level function for skills, which are org-wide rather than per-brand:

```python
def sync_skills(db: Session) -> None:
    from app.db.models import Skill
    from sqlalchemy import select as _select
    for skill in db.scalars(_select(Skill).where(Skill.enabled.is_(True))).all():
        target = Path(settings.SHARED_VOLUME_ROOT) / "skills" / skill.name / "SKILL.md"
        _write_if_changed(target, storage.get(skill.storage_ref))
```

Call `brand_sync.sync_skills(db)` in `run_job` immediately after `sync_brand`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_generation_payload.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/workers/generation_worker.py backend/app/services/brand_sync.py backend/tests/test_generation_payload.py
git commit -m "feat: scope-filtered references, real assets and matching skills in the generation payload"
```

---

## Phase 3 — Quality and workflow

### Task 21: Rasterisation — the front half of the verification loop

Steps 2–4 of PRD §6.1: validate structurally, convert to PDF, rasterise the pages.

**Files:**
- Create: `backend/app/services/qa/rasterize.py`
- Test: `backend/tests/test_rasterize.py`

**Interfaces:**
- Produces: `pptx_to_pdf(pptx_path: Path, out_dir: Path) -> Path`; `html_to_pdf(html_path: Path, out_dir: Path) -> Path`; `pdf_to_pages(pdf_path: Path, out_dir: Path, dpi: int) -> list[Path]`; `validate_pptx(path: Path) -> list[str]`; `embedded_fonts(pdf_path: Path) -> set[str]`; `RasterizeError`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_rasterize.py
import pytest, shutil
from pathlib import Path
from app.services.qa import rasterize

FIXTURE = Path(__file__).parent / "fixtures" / "two_slide.pptx"
needs_soffice = pytest.mark.skipif(not shutil.which("soffice"), reason="needs libreoffice")
needs_poppler = pytest.mark.skipif(not shutil.which("pdftoppm"), reason="needs poppler")

def test_a_valid_pptx_reports_no_structural_errors():
    assert rasterize.validate_pptx(FIXTURE) == []

def test_a_corrupt_pptx_reports_a_structural_error(tmp_path):
    bad = tmp_path / "bad.pptx"
    bad.write_bytes(b"not a zip")
    errors = rasterize.validate_pptx(bad)
    assert errors and "unreadable" in errors[0]

def test_a_pptx_with_zero_slides_is_a_structural_error(tmp_path):
    from pptx import Presentation
    empty = tmp_path / "empty.pptx"
    prs = Presentation()
    for slide_id in list(prs.slides._sldIdLst):
        prs.slides._sldIdLst.remove(slide_id)
    prs.save(empty)
    assert any("no slides" in e for e in rasterize.validate_pptx(empty))

@needs_soffice
def test_pptx_converts_to_a_pdf(tmp_path):
    pdf = rasterize.pptx_to_pdf(FIXTURE, tmp_path)
    assert pdf.exists() and pdf.suffix == ".pdf"

@needs_soffice
@needs_poppler
def test_pdf_rasterises_to_one_jpeg_per_page(tmp_path):
    pdf = rasterize.pptx_to_pdf(FIXTURE, tmp_path)
    pages = rasterize.pdf_to_pages(pdf, tmp_path, dpi=72)
    assert len(pages) == 2
    assert all(p.suffix == ".jpg" for p in pages)

@needs_soffice
def test_embedded_fonts_are_readable_from_the_pdf(tmp_path):
    pdf = rasterize.pptx_to_pdf(FIXTURE, tmp_path)
    assert rasterize.embedded_fonts(pdf)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_rasterize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.qa.rasterize'`

- [ ] **Step 3: Write the module**

```python
# backend/app/services/qa/rasterize.py
"""Steps 2-4 of the verification loop.

PRD 6.1: reading a text layer is not a review — every layout defect is
invisible there. So output is converted to PDF and rasterised, and the checks
in qa/checks/ look at pixels.
"""
from __future__ import annotations
import re
import shutil
import subprocess
from pathlib import Path

class RasterizeError(RuntimeError):
    """A conversion tool was missing or failed."""

def _run(command: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
    if shutil.which(command[0]) is None:
        raise RasterizeError(f"{command[0]} is not installed in this container")
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    if result.returncode != 0:
        raise RasterizeError(f"{command[0]} failed: {result.stderr.decode()[:400]}")
    return result

def validate_pptx(path: Path) -> list[str]:
    """PRD 6.1 step 2, marked P0: catch corrupt files before a client sees one."""
    errors: list[str] = []
    try:
        from pptx import Presentation
        prs = Presentation(str(path))
    except Exception as exc:
        return [f"unreadable pptx: {exc}"]
    slides = list(prs.slides)
    if not slides:
        errors.append("no slides in presentation")
    for index, slide in enumerate(slides, start=1):
        if slide.slide_layout is None:
            errors.append(f"slide {index} has no master layout")
    return errors

def pptx_to_pdf(pptx_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    _run(["soffice", "--headless", "--convert-to", "pdf",
          "--outdir", str(out_dir), str(pptx_path)], timeout=300)
    pdf = out_dir / f"{pptx_path.stem}.pdf"
    if not pdf.exists():
        raise RasterizeError("libreoffice produced no pdf")
    return pdf

def html_to_pdf(html_path: Path, out_dir: Path) -> Path:
    """Chromium is already installed for the DOM probe, so it does this too."""
    from playwright.sync_api import sync_playwright
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = out_dir / f"{html_path.stem}.pdf"
    with sync_playwright() as play:
        browser = play.chromium.launch()
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri())
        page.pdf(path=str(pdf), print_background=True)
        browser.close()
    return pdf

def pdf_to_pages(pdf_path: Path, out_dir: Path, dpi: int) -> list[Path]:
    """PRD 6.1 step 4, verbatim: pdftoppm -jpeg -r 100."""
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = out_dir / pdf_path.stem
    _run(["pdftoppm", "-jpeg", "-r", str(dpi), str(pdf_path), str(prefix)])
    return sorted(out_dir.glob(f"{pdf_path.stem}-*.jpg"))

def embedded_fonts(pdf_path: Path) -> set[str]:
    """Font names actually embedded in the PDF — the ground truth for the
    silent-fallback check in PRD 6.2."""
    result = _run(["pdffonts", str(pdf_path)])
    names = set()
    for line in result.stdout.decode().splitlines()[2:]:
        raw = line.split()[0] if line.split() else ""
        # Subset fonts are prefixed like "ABCDEF+Inter-Bold".
        names.add(re.sub(r"^[A-Z]{6}\+", "", raw))
    return {n for n in names if n}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_rasterize.py -v`
Expected: 6 passed inside the container; the `soffice`/`pdftoppm` tests skip on a bare host

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/qa/rasterize.py backend/tests/test_rasterize.py
git commit -m "feat: structural validation, pdf conversion and rasterisation"
```

### Task 22: The seven automated checks

Every check in PRD §6.2, one file each.

**Files:**
- Create: `backend/app/services/qa/dom_probe.py`
- Create: `backend/app/services/qa/checks/overflow.py`, `bounds.py`, `fill.py`, `tokens.py`, `palette.py`, `fonts.py`, `determinism.py`
- Create: `backend/app/services/qa/checks/__init__.py`
- Test: `backend/tests/test_qa_checks.py`

**Interfaces:**
- Produces: dataclass `Finding(check: str, severity: str, detail: str, page: int | None)`; one `run(...) -> list[Finding]` per check module; `probe_geometry(html_path: Path) -> list[dict]` in `dom_probe`; `ALL_CHECKS: dict[str, callable]` in `checks/__init__.py`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_qa_checks.py
from pathlib import Path
from PIL import Image
from app.services.qa.checks import overflow, bounds, fill, tokens, palette, fonts, determinism

def _html(tmp_path, body: str) -> Path:
    path = tmp_path / "page.html"
    path.write_text(f"<html><body style='margin:0;width:800px;height:600px'>{body}</body></html>")
    return path

def _solid(tmp_path, name, colour, size=(400, 300)):
    path = tmp_path / name
    Image.new("RGB", size, colour).save(path)
    return path

def test_overflow_flags_text_wider_than_its_box(tmp_path):
    page = _html(tmp_path, "<div style='width:50px;overflow:hidden;white-space:nowrap'"
                           " id='a'>a very long headline indeed</div>")
    findings = overflow.run(page)
    assert [f.check for f in findings] == ["overflow"]

def test_overflow_passes_a_fitting_box(tmp_path):
    page = _html(tmp_path, "<div style='width:400px' id='a'>short</div>")
    assert overflow.run(page) == []

def test_bounds_flags_an_element_off_canvas(tmp_path):
    page = _html(tmp_path, "<div style='position:absolute;left:900px' id='a'>x</div>")
    assert [f.check for f in bounds.run(page)] == ["bounds"]

def test_fill_flags_a_mostly_empty_page(tmp_path):
    findings = fill.run([_solid(tmp_path, "p1.jpg", (255, 255, 255))], min_ratio=0.35)
    assert [f.check for f in findings] == ["fill"]

def test_fill_passes_a_dense_page(tmp_path):
    img = Image.new("RGB", (400, 300), (255, 255, 255))
    for x in range(0, 400):
        for y in range(0, 200):
            img.putpixel((x, y), (10, 10, 10))
    path = tmp_path / "dense.jpg"; img.save(path)
    assert fill.run([path], min_ratio=0.35) == []

def test_tokens_flags_a_price_broken_across_lines(tmp_path):
    page = _html(tmp_path, "<div style='width:30px' id='a'>$1,499.00</div>")
    assert [f.check for f in tokens.run(page)] == ["tokens"]

def test_tokens_passes_an_intact_price(tmp_path):
    page = _html(tmp_path, "<div style='width:400px' id='a'>$1,499.00</div>")
    assert tokens.run(page) == []

def test_palette_flags_an_undeclared_colour(tmp_path):
    findings = palette.run([_solid(tmp_path, "p.jpg", (200, 30, 30))],
                            allowed_hex=["#0A0A0A", "#FFFFFF"], tolerance=12)
    assert [f.check for f in findings] == ["palette"]

def test_palette_passes_a_declared_colour_within_tolerance(tmp_path):
    findings = palette.run([_solid(tmp_path, "p.jpg", (10, 10, 10))],
                            allowed_hex=["#0A0A0A"], tolerance=12)
    assert findings == []

def test_fonts_flags_a_silent_fallback():
    findings = fonts.run(embedded={"DejaVuSans"}, declared={"Inter", "Inter-Bold"})
    assert [f.check for f in findings] == ["fonts"]
    assert "Inter" in findings[0].detail

def test_fonts_passes_when_declared_fonts_are_embedded():
    assert fonts.run(embedded={"Inter", "Inter-Bold"}, declared={"Inter"}) == []

def test_determinism_flags_differing_builds(tmp_path):
    a = [_solid(tmp_path, "a.jpg", (0, 0, 0))]
    b = [_solid(tmp_path, "b.jpg", (255, 255, 255))]
    assert [f.check for f in determinism.run(a, b)] == ["determinism"]

def test_determinism_passes_identical_builds(tmp_path):
    a = [_solid(tmp_path, "a.jpg", (0, 0, 0))]
    b = [_solid(tmp_path, "b.jpg", (0, 0, 0))]
    assert determinism.run(a, b) == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_qa_checks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.qa.checks'`

- [ ] **Step 3: Write the shared Finding type and the DOM probe**

```python
# backend/app/services/qa/checks/__init__.py
from dataclasses import dataclass

@dataclass(frozen=True)
class Finding:
    check: str
    severity: str          # "error" blocks the gate; "warning" does not
    detail: str
    page: int | None = None

    def as_dict(self) -> dict:
        return {"check": self.check, "severity": self.severity,
                "detail": self.detail, "page": self.page}
```

```python
# backend/app/services/qa/dom_probe.py
"""Measure real layout geometry in a headless browser.

PRD 6.1 warns that reading a text layer is not a review, and it is right — but
DOM geometry is not a text layer. scrollWidth vs clientWidth is the same
overflow a rasteriser would have to infer from pixels, read exactly and
cheaply. Raster checks still own everything the DOM cannot see: fill ratio,
palette, embedded fonts, determinism.

ponytail: code-mode only. An image-mode artifact has no DOM, so the pipeline
skips these two checks for it rather than approximating them from pixels.
"""
from __future__ import annotations
from pathlib import Path

PROBE_JS = """
() => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    out.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      text: (el.textContent || '').trim().slice(0, 120),
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      lineCount: Math.max(1, el.getClientRects().length),
      viewportWidth: vw, viewportHeight: vh,
    });
  });
  return out;
}
"""

def probe_geometry(html_path: Path) -> list[dict]:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as play:
        browser = play.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 1200})
        page.goto(html_path.resolve().as_uri())
        page.wait_for_load_state("networkidle")
        boxes = page.evaluate(PROBE_JS)
        browser.close()
    return boxes
```

- [ ] **Step 4: Write the four geometry and raster checks**

```python
# backend/app/services/qa/checks/overflow.py
"""No text overflows its container or card boundary. PRD 6.2."""
from pathlib import Path
from app.services.qa.checks import Finding
from app.services.qa.dom_probe import probe_geometry

SLACK_PX = 1   # sub-pixel rounding, not a defect

def run(html_path: Path) -> list[Finding]:
    findings = []
    for box in probe_geometry(html_path):
        wide = box["scrollWidth"] - box["clientWidth"] > SLACK_PX
        tall = box["scrollHeight"] - box["clientHeight"] > SLACK_PX
        if wide or tall:
            findings.append(Finding(
                "overflow", "error",
                f"<{box['tag']}{'#' + box['id'] if box['id'] else ''}> content "
                f"{box['scrollWidth']}x{box['scrollHeight']} exceeds box "
                f"{box['clientWidth']}x{box['clientHeight']}: {box['text'][:60]!r}"))
    return findings
```

```python
# backend/app/services/qa/checks/bounds.py
"""No element sits outside the canvas bounds. PRD 6.2."""
from pathlib import Path
from app.services.qa.checks import Finding
from app.services.qa.dom_probe import probe_geometry

SLACK_PX = 1

def run(html_path: Path) -> list[Finding]:
    findings = []
    for box in probe_geometry(html_path):
        out_left = box["left"] < -SLACK_PX
        out_top = box["top"] < -SLACK_PX
        out_right = box["right"] > box["viewportWidth"] + SLACK_PX
        out_bottom = box["bottom"] > box["viewportHeight"] + SLACK_PX
        if out_left or out_top or out_right or out_bottom:
            findings.append(Finding(
                "bounds", "error",
                f"<{box['tag']}> at ({box['left']:.0f},{box['top']:.0f})-"
                f"({box['right']:.0f},{box['bottom']:.0f}) leaves the "
                f"{box['viewportWidth']}x{box['viewportHeight']} canvas"))
    return findings
```

```python
# backend/app/services/qa/checks/tokens.py
"""No identifier, date, price or numeric token is broken across lines. PRD 6.2."""
import re
from pathlib import Path
from app.services.qa.checks import Finding
from app.services.qa.dom_probe import probe_geometry

# Things that must never wrap mid-token.
UNBREAKABLE = re.compile(
    r"[$£€]\s?\d[\d,]*(?:\.\d+)?"        # prices
    r"|\b\d{4}-\d{2}-\d{2}\b"             # ISO dates
    r"|\b\d[\d,]*(?:\.\d+)?%\b"           # percentages
    r"|\b[A-Z]{2,}-\d{2,}\b"              # identifiers like INV-1042
)

def run(html_path: Path) -> list[Finding]:
    findings = []
    for box in probe_geometry(html_path):
        matches = UNBREAKABLE.findall(box["text"])
        if not matches:
            continue
        # A single-line box cannot have split anything. A multi-line box whose
        # content is narrower than one token has.
        if box["lineCount"] > 1 or box["scrollWidth"] > box["clientWidth"]:
            findings.append(Finding(
                "tokens", "error",
                f"<{box['tag']}> may break {matches[0]!r} across lines "
                f"({box['lineCount']} line boxes at width {box['clientWidth']})"))
    return findings
```

```python
# backend/app/services/qa/checks/fill.py
"""No card or slide is less than a defined fill threshold. PRD 6.2."""
from pathlib import Path
from PIL import Image
from app.services.qa.checks import Finding

BACKGROUND_TOLERANCE = 8

def _fill_ratio(path: Path) -> float:
    """Share of pixels differing from the page's dominant (background) colour."""
    image = Image.open(path).convert("RGB")
    pixels = list(image.getdata())
    background = max(set(pixels), key=pixels.count)
    def near(pixel) -> bool:
        return all(abs(a - b) <= BACKGROUND_TOLERANCE for a, b in zip(pixel, background))
    return 1.0 - (sum(1 for p in pixels if near(p)) / len(pixels))

def run(pages: list[Path], min_ratio: float) -> list[Finding]:
    findings = []
    for index, page in enumerate(pages, start=1):
        ratio = _fill_ratio(page)
        if ratio < min_ratio:
            findings.append(Finding(
                "fill", "error",
                f"page {index} is {ratio:.0%} filled, below the {min_ratio:.0%} "
                f"threshold — dead space", page=index))
    return findings
```

- [ ] **Step 5: Write the palette, fonts and determinism checks**

```python
# backend/app/services/qa/checks/palette.py
"""Brand palette compliance — no colours outside the declared tokens. PRD 6.2."""
from pathlib import Path
from PIL import Image
from app.services.qa.checks import Finding

# Colours below this share are antialiasing and image content, not brand breaks.
MIN_SHARE = 0.005

def _rgb(hex_value: str) -> tuple[int, int, int]:
    value = hex_value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))

def run(pages: list[Path], allowed_hex: list[str], tolerance: int) -> list[Finding]:
    if not allowed_hex:
        return []   # brand declared no tokens; nothing to enforce
    allowed = [_rgb(h) for h in allowed_hex]
    findings = []
    for index, page in enumerate(pages, start=1):
        image = Image.open(page).convert("RGB")
        total = image.width * image.height
        for count, colour in image.getcolors(maxcolors=1_000_000) or []:
            if count / total < MIN_SHARE:
                continue
            if any(all(abs(a - b) <= tolerance for a, b in zip(colour, token))
                   for token in allowed):
                continue
            findings.append(Finding(
                "palette", "error",
                f"page {index} uses #{colour[0]:02X}{colour[1]:02X}{colour[2]:02X} "
                f"({count / total:.1%} of pixels), outside the declared palette",
                page=index))
    return findings
```

```python
# backend/app/services/qa/checks/fonts.py
"""Declared brand fonts are the fonts actually rendered. PRD 6.2, 4.4.

This is the check that catches silent fallback — the failure mode that makes
brand systems decorative and regression testing impossible.
"""
from app.services.qa.checks import Finding

def _family(name: str) -> str:
    return name.split("-")[0].split(",")[0].strip().lower()

def run(embedded: set[str], declared: set[str]) -> list[Finding]:
    if not declared:
        return []
    embedded_families = {_family(n) for n in embedded}
    missing = sorted(d for d in declared if _family(d) not in embedded_families)
    if not missing:
        return []
    return [Finding(
        "fonts", "error",
        f"declared font(s) {missing} are not embedded; rendered fonts were "
        f"{sorted(embedded)} — silent fallback")]
```

```python
# backend/app/services/qa/checks/determinism.py
"""Two consecutive builds of identical input produce identical output. PRD 6.2."""
import hashlib
from pathlib import Path
from app.services.qa.checks import Finding

def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(build_a: list[Path], build_b: list[Path]) -> list[Finding]:
    if len(build_a) != len(build_b):
        return [Finding("determinism", "error",
                        f"rebuild produced {len(build_b)} pages, first build "
                        f"produced {len(build_a)}")]
    for index, (a, b) in enumerate(zip(build_a, build_b), start=1):
        if _digest(a) != _digest(b):
            return [Finding("determinism", "error",
                            f"page {index} differs between two builds of identical input",
                            page=index)]
    return []
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pytest tests/test_qa_checks.py -v`
Expected: 13 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/qa/ backend/tests/test_qa_checks.py
git commit -m "feat: the seven automated qa checks from PRD 6.2"
```

### Task 23: The QA gate, wired into the worker

**Files:**
- Create: `backend/app/services/qa/pipeline.py`
- Modify: `backend/app/workers/generation_worker.py` (replace `_run_qa`)
- Modify: `backend/app/api/v1/artifacts.py` (add the QA re-run route)
- Test: `backend/tests/test_qa_pipeline.py`

**Interfaces:**
- Consumes: everything from Tasks 21 and 22, plus `latest_design`.
- Produces: `run_qa(db, artifact, work_dir) -> dict` returning the `qa_report` shape `{"passed": bool, "findings": [...], "checks_run": [...], "skipped": [...]}`; `declared_palette(design_md) -> list[str]`; `declared_fonts(design_md) -> set[str]`; `POST /api/v1/artifacts/{artifact_id}/qa`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_qa_pipeline.py
from app.services.qa import pipeline

DESIGN = """# Ladder
## Palette
- ink `#0A0A0A`
- paper `#FFFFFF`
- accent `#3B5BFF`
## Type
Headings use `Inter`. Body uses `Inter`.
"""

def test_palette_tokens_are_read_from_design_md():
    assert pipeline.declared_palette(DESIGN) == ["#0A0A0A", "#FFFFFF", "#3B5BFF"]

def test_font_families_are_read_from_design_md():
    assert pipeline.declared_fonts(DESIGN) == {"Inter"}

def test_a_design_md_with_no_palette_yields_no_tokens():
    assert pipeline.declared_palette("# Brand\nNo colours here.") == []

def test_report_passes_when_no_check_reports_an_error(db_session, clean_artifact,
                                                      tmp_path, stub_checks_pass):
    report = pipeline.run_qa(db_session, clean_artifact, tmp_path)
    assert report["passed"] is True
    assert report["findings"] == []

def test_report_fails_and_lists_findings(db_session, clean_artifact, tmp_path,
                                         stub_checks_overflow):
    report = pipeline.run_qa(db_session, clean_artifact, tmp_path)
    assert report["passed"] is False
    assert report["findings"][0]["check"] == "overflow"

def test_warnings_alone_do_not_fail_the_gate(db_session, clean_artifact, tmp_path,
                                             stub_checks_warning):
    report = pipeline.run_qa(db_session, clean_artifact, tmp_path)
    assert report["passed"] is True
    assert report["findings"]

def test_image_mode_skips_the_dom_checks(db_session, image_artifact, tmp_path,
                                          stub_checks_pass):
    report = pipeline.run_qa(db_session, image_artifact, tmp_path)
    assert set(report["skipped"]) >= {"overflow", "bounds", "tokens"}

def test_a_qa_failure_sets_the_artifact_status(db_session, queued_artifact,
                                               fake_open_design, stub_checks_overflow):
    from app.workers import queue, generation_worker
    from app.db.models import Artifact, ArtifactStatus
    job = queue.claim(db_session)
    generation_worker.run_job(db_session, job)
    assert db_session.get(Artifact, queued_artifact).status == ArtifactStatus.QA_FAILED
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_qa_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.qa.pipeline'`

- [ ] **Step 3: Write the pipeline**

```python
# backend/app/services/qa/pipeline.py
"""The QA gate. Mechanical, runs on every generation, depends on no third-party
slop detector. PRD 6.1.

    1. Generate the artifact          (done by the worker)
    2. Validate structurally
    3. Convert to PDF
    4. Rasterise the pages
    5. Inspect                        (automated here, human review after)
    6. Fix and repeat                 (the member iterates)
"""
from __future__ import annotations
import re
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app.api.v1.contracts import latest_design
from app.core.config import settings
from app.db.models import Artifact, ArtifactType, GenerationMode
from app.services import open_design as od
from app.services.qa import rasterize
from app.services.qa.checks import Finding, overflow, bounds, fill, tokens, palette, fonts

HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}\b")
FONT_RE = re.compile(r"`([A-Za-z][A-Za-z0-9 _-]{1,40})`")
FONT_CONTEXT = re.compile(r"(?im)^.*\b(font|type|typeface|heading|body)\b.*$")

DOM_CHECKS = ("overflow", "bounds", "tokens")

def declared_palette(design_md: str) -> list[str]:
    seen: list[str] = []
    for match in HEX_RE.findall(design_md or ""):
        upper = match.upper()
        if upper not in seen:
            seen.append(upper)
    return seen

def declared_fonts(design_md: str) -> set[str]:
    """Backticked names on lines that talk about type. Loose on purpose: a
    missed font means one skipped check, a false positive means a permanently
    red gate on a correct artifact."""
    names = set()
    for line in FONT_CONTEXT.findall(design_md or "") and (design_md or "").splitlines():
        if not re.search(r"(?i)\b(font|type|typeface|heading|body)\b", line):
            continue
        names.update(FONT_RE.findall(line))
    return {n.strip() for n in names if n.strip()}

def _fetch_exports(artifact: Artifact, work_dir: Path) -> dict[str, Path]:
    work_dir.mkdir(parents=True, exist_ok=True)
    local: dict[str, Path] = {}
    for fmt, url in (artifact.export_urls or {}).items():
        if not isinstance(url, str):
            continue
        path = work_dir / f"{artifact.id}.{fmt}"
        path.write_bytes(od.download_export(url))
        local[fmt] = path
    return local

def _to_pages(artifact: Artifact, local: dict[str, Path], work_dir: Path) -> tuple[list[Path], Path | None]:
    """Returns (rasterised pages, pdf used) — the pdf is needed for font checks."""
    if "pdf" in local:
        pdf = local["pdf"]
    elif "pptx" in local:
        pdf = rasterize.pptx_to_pdf(local["pptx"], work_dir)
    elif "html" in local:
        pdf = rasterize.html_to_pdf(local["html"], work_dir)
    else:
        # png / jpg artifacts are already raster.
        return [p for fmt, p in local.items() if fmt in ("png", "jpg")], None
    return rasterize.pdf_to_pages(pdf, work_dir, settings.QA_RASTER_DPI), pdf

def run_qa(db: Session, artifact: Artifact, work_dir: Path) -> dict:
    design = latest_design(db, artifact.brand_id)
    design_md = design.design_md_content if design else ""

    findings: list[Finding] = []
    ran: list[str] = []
    skipped: list[str] = []

    local = _fetch_exports(artifact, work_dir)

    # Step 2 — structural validation. P0 for PPTX.
    if "pptx" in local:
        ran.append("structure")
        for error in rasterize.validate_pptx(local["pptx"]):
            findings.append(Finding("structure", "error", error))
        if findings:
            # A corrupt file cannot be rasterised; stop rather than cascade.
            return _report(findings, ran, skipped)

    # Steps 3-4 — pdf and raster.
    pages, pdf = _to_pages(artifact, local, work_dir)

    # Step 5a — geometry checks, code-mode only.
    if artifact.generation_mode == GenerationMode.CODE and "html" in local:
        for name, module in (("overflow", overflow), ("bounds", bounds), ("tokens", tokens)):
            ran.append(name)
            findings.extend(module.run(local["html"]))
    else:
        skipped.extend(DOM_CHECKS)

    # Step 5b — raster checks.
    if pages:
        ran.append("fill")
        findings.extend(fill.run(pages, settings.QA_MIN_FILL_RATIO))
        ran.append("palette")
        findings.extend(palette.run(pages, declared_palette(design_md),
                                     settings.QA_PALETTE_TOLERANCE))
    else:
        skipped.extend(["fill", "palette"])

    if pdf is not None:
        ran.append("fonts")
        findings.extend(fonts.run(rasterize.embedded_fonts(pdf), declared_fonts(design_md)))
    else:
        skipped.append("fonts")

    # ponytail: determinism needs a second full generation, so it runs in the
    # fixture-matrix command (Task 24), not on every member-triggered build.
    skipped.append("determinism")

    shutil.rmtree(work_dir, ignore_errors=True)
    return _report(findings, ran, skipped)

def _report(findings: list[Finding], ran: list[str], skipped: list[str]) -> dict:
    return {
        "passed": not any(f.severity == "error" for f in findings),
        "findings": [f.as_dict() for f in findings],
        "checks_run": ran,
        "skipped": skipped,
    }
```

- [ ] **Step 4: Replace the worker's placeholder QA**

```python
# backend/app/workers/generation_worker.py  (replace _run_qa)
def _run_qa(db: Session, artifact: Artifact) -> None:
    from pathlib import Path
    from app.services.qa import pipeline
    work_dir = Path(settings.SHARED_VOLUME_ROOT) / "qa" / artifact.id
    try:
        report = pipeline.run_qa(db, artifact, work_dir)
    except Exception as exc:   # a broken gate must not silently pass an artifact
        logger.exception("qa pipeline crashed for %s", artifact.id)
        report = {"passed": False, "findings": [
            {"check": "qa_pipeline", "severity": "error",
             "detail": f"gate crashed: {exc}", "page": None}],
            "checks_run": [], "skipped": []}
    artifact.qa_report = report
    artifact.status = ArtifactStatus.READY if report["passed"] else ArtifactStatus.QA_FAILED
    db.commit()
```

- [ ] **Step 5: Add the QA re-run route**

```python
# backend/app/api/v1/artifacts.py  (append)
@router.post("/{artifact_id}/qa", response_model=ArtifactOut)
def rerun_qa(artifact_id: str, db: Session = Depends(get_db),
             _: User = Depends(current_user)):
    """Re-run the gate without regenerating — useful after DESIGN.md changes."""
    from pathlib import Path
    from app.core.config import settings
    from app.services.qa import pipeline
    artifact = get_artifact(db, artifact_id)
    if not artifact.export_urls:
        raise HTTPException(status.HTTP_409_CONFLICT, "nothing generated to check")
    report = pipeline.run_qa(db, artifact, Path(settings.SHARED_VOLUME_ROOT) / "qa" / artifact.id)
    artifact.qa_report = report
    artifact.status = ArtifactStatus.READY if report["passed"] else ArtifactStatus.QA_FAILED
    db.commit(); db.refresh(artifact)
    return artifact
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pytest tests/test_qa_pipeline.py -v`
Expected: 8 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/qa/pipeline.py backend/app/workers/generation_worker.py backend/app/api/v1/artifacts.py backend/tests/test_qa_pipeline.py
git commit -m "feat: mechanical qa gate wired into the worker with a re-run route"
```

### Task 24: Fixture matrix and slot cardinality

Every brand template gets rendered against four content payloads before it is trusted. (PRD §6.3)

**Files:**
- Create: `backend/app/services/qa/slots.py`
- Create: `backend/app/services/qa/fixtures.py`
- Create: `backend/app/cli.py`
- Test: `backend/tests/test_slots.py`, `backend/tests/test_fixtures.py`

**Interfaces:**
- Produces: `Slot(name, cardinality, overflow_policy)`; `SlotError`; `plan_slot(slot, item_count) -> SlotPlan`; `SlotPlan(action, rendered_count, note)`; `FIXTURE_CASES: dict[str, dict]`; `run_matrix(db, brand_id, artifact_type, model_provider_id) -> dict`; CLI entry `python -m app.cli fixtures --brand <slug> --type <artifact_type>`.

- [ ] **Step 1: Write the failing test for slots**

```python
# backend/tests/test_slots.py
import pytest
from app.services.qa.slots import Slot, SlotError, plan_slot

FIVE_CARDS = Slot(name="cards", cardinality="1..n", overflow_policy=
                  ["reflow", "rebalance", "scale", "variant", "continue"])

def test_a_group_given_fewer_items_drops_the_whole_group():
    plan = plan_slot(Slot("cards", "0..n", ["reflow"]), item_count=3, designed_for=5)
    assert plan.rendered_count == 3
    assert plan.action == "drop_group"
    assert "3 of 5" in plan.note

def test_an_emptied_card_is_never_produced():
    plan = plan_slot(FIVE_CARDS, item_count=3, designed_for=5)
    assert "empty" not in plan.action

def test_overflow_escalates_through_the_declared_policy():
    plan = plan_slot(FIVE_CARDS, item_count=12, designed_for=5)
    assert plan.action == "reflow"
    assert plan.rendered_count == 12

def test_a_required_slot_given_zero_items_errors_loudly():
    with pytest.raises(SlotError, match="cardinality 1"):
        plan_slot(Slot("headline", "1", ["reflow"]), item_count=0, designed_for=1)

def test_content_is_never_silently_clipped():
    plan = plan_slot(Slot("cards", "1..n", ["scale"]), item_count=40, designed_for=5)
    assert plan.action != "clip"
    assert plan.rendered_count == 40

def test_an_exhausted_policy_errors_rather_than_rendering_broken_output():
    with pytest.raises(SlotError, match="no overflow policy"):
        plan_slot(Slot("cards", "1..n", []), item_count=40, designed_for=5)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_slots.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.qa.slots'`

- [ ] **Step 3: Write the slot module**

```python
# backend/app/services/qa/slots.py
"""Template slots are not source items. PRD 6.3.

A layout showing five cards given three items must drop the entire card group,
not empty its text — an emptied card is a hole. Every slot declares cardinality
and an overflow policy, and the system errors loudly rather than rendering
something broken.
"""
from __future__ import annotations
from dataclasses import dataclass

CARDINALITIES = {"1", "1..n", "0..n"}
POLICIES = ("reflow", "rebalance", "scale", "variant", "continue")

class SlotError(ValueError):
    """The content cannot be placed in this slot without breaking the layout."""

@dataclass(frozen=True)
class Slot:
    name: str
    cardinality: str            # "1" | "1..n" | "0..n"
    overflow_policy: list[str]  # ordered subset of POLICIES

    def __post_init__(self) -> None:
        if self.cardinality not in CARDINALITIES:
            raise SlotError(f"{self.name}: unknown cardinality {self.cardinality!r}")
        unknown = set(self.overflow_policy) - set(POLICIES)
        if unknown:
            raise SlotError(f"{self.name}: unknown overflow policy {sorted(unknown)}")

@dataclass(frozen=True)
class SlotPlan:
    action: str
    rendered_count: int
    note: str

def plan_slot(slot: Slot, item_count: int, designed_for: int) -> SlotPlan:
    if slot.cardinality == "1" and item_count != 1:
        raise SlotError(f"{slot.name}: cardinality 1 but got {item_count} items")
    if slot.cardinality == "1..n" and item_count == 0:
        raise SlotError(f"{slot.name}: cardinality 1..n but got 0 items")

    if item_count < designed_for:
        # Drop the group. Never render an empty card.
        return SlotPlan("drop_group", item_count,
                        f"{slot.name}: rendering {item_count} of {designed_for} "
                        f"designed slots; surplus groups dropped whole")

    if item_count == designed_for:
        return SlotPlan("exact", item_count, f"{slot.name}: exact fit")

    if not slot.overflow_policy:
        raise SlotError(f"{slot.name}: {item_count} items exceed {designed_for} "
                        f"and no overflow policy is declared")
    # Escalation order is the declared order; the first policy handles it and
    # a later QA failure is what pushes a template to the next one.
    return SlotPlan(slot.overflow_policy[0], item_count,
                    f"{slot.name}: {item_count} items over {designed_for}, "
                    f"applying '{slot.overflow_policy[0]}'")
```

- [ ] **Step 4: Write the failing test for the fixture matrix**

```python
# backend/tests/test_fixtures.py
from app.services.qa.fixtures import FIXTURE_CASES, run_matrix

def test_all_four_cases_are_defined():
    assert set(FIXTURE_CASES) == {"minimum", "expected", "maximum", "pathological"}

def test_minimum_case_underfills_a_five_card_carousel():
    assert FIXTURE_CASES["minimum"]["carousel"]["item_count"] == 1

def test_maximum_case_overfills_a_five_card_carousel():
    assert FIXTURE_CASES["maximum"]["carousel"]["item_count"] == 12

def test_maximum_case_uses_a_forty_slide_deck():
    assert FIXTURE_CASES["maximum"]["deck"]["item_count"] == 40

def test_pathological_case_carries_every_named_hazard():
    payload = FIXTURE_CASES["pathological"]["carousel"]["payload"]
    assert len(payload["headline"]) >= 200
    assert len(payload["unbroken_string"]) >= 40
    assert " " not in payload["unbroken_string"]
    assert payload["optional_section"] == ""
    assert len(payload["list"]) == 1

def test_matrix_runs_every_case_and_reports_per_case(db_session, brand_with_template,
                                                     stub_generate_and_qa):
    result = run_matrix(db_session, brand_with_template, "carousel", "provider-1")
    assert set(result["cases"]) == set(FIXTURE_CASES)
    assert result["trusted"] in (True, False)

def test_matrix_is_untrusted_when_any_case_fails(db_session, brand_with_template,
                                                 stub_generate_qa_fails_maximum):
    result = run_matrix(db_session, brand_with_template, "carousel", "provider-1")
    assert result["trusted"] is False
    assert result["cases"]["maximum"]["passed"] is False

def test_matrix_runs_the_determinism_check(db_session, brand_with_template,
                                           stub_generate_and_qa):
    result = run_matrix(db_session, brand_with_template, "carousel", "provider-1")
    assert "determinism" in result["cases"]["expected"]["checks_run"]
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pytest tests/test_fixtures.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.qa.fixtures'`

- [ ] **Step 6: Write the fixture matrix**

```python
# backend/app/services/qa/fixtures.py
"""Every brand template renders against four content payloads before it is
trusted. PRD 6.3.

This is a dev command, not a member-facing feature. It is also the only place
the determinism check runs, because it is the only place that generates the
same input twice on purpose.
"""
from __future__ import annotations
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Artifact, ArtifactStatus, ArtifactType, Brand, GenerationMode
from app.services import open_design as od
from app.services.qa import pipeline, rasterize
from app.services.qa.checks import determinism

LONG_HEADLINE = (
    "A headline long enough to test what happens when a member pastes an entire "
    "paragraph into a slot that was designed for six words, which is exactly "
    "the thing that happens in week two of real use and never in a demo."
)
UNBROKEN = "supercalifragilisticexpialidociousandthensome"

FIXTURE_CASES: dict[str, dict] = {
    "minimum": {
        "carousel": {"item_count": 1, "payload": {"items": ["One item."]}},
        "deck": {"item_count": 2, "payload": {"items": ["Slide one.", "Slide two."]}},
    },
    "expected": {
        "carousel": {"item_count": 5, "payload": {"items": [f"Card {i}." for i in range(1, 6)]}},
        "deck": {"item_count": 12, "payload": {"items": [f"Slide {i}." for i in range(1, 13)]}},
    },
    "maximum": {
        "carousel": {"item_count": 12, "payload": {"items": [f"Card {i}." for i in range(1, 13)]}},
        "deck": {"item_count": 40, "payload": {"items": [f"Slide {i}." for i in range(1, 41)]}},
    },
    "pathological": {
        "carousel": {"item_count": 1, "payload": {
            "headline": LONG_HEADLINE,
            "unbroken_string": UNBROKEN,
            "optional_section": "",
            "list": ["The only item."],
            "items": ["The only item."],
        }},
        "deck": {"item_count": 1, "payload": {
            "headline": LONG_HEADLINE,
            "unbroken_string": UNBROKEN,
            "optional_section": "",
            "list": ["The only item."],
            "items": ["The only item."],
        }},
    },
}

def _generate(db: Session, brand: Brand, artifact_type: str, provider_id: str,
              payload: dict) -> Artifact:
    artifact = Artifact(
        brand_id=brand.id, brief_id="fixture", copy_id=None,
        artifact_type=ArtifactType(artifact_type),
        generation_mode=GenerationMode.CODE, model_provider_id=provider_id,
        status=ArtifactStatus.GENERATING, version=1, created_by="fixture-runner")
    db.add(artifact); db.commit(); db.refresh(artifact)
    outcome = od.generate(od.GenerationRequest(
        brand_slug=brand.slug, artifact_type=artifact_type, mode="code",
        copy_text=str(payload), design_md="", reference_specs=[], asset_paths=[],
        skill_paths=[], model_name="", variant_index=0))
    artifact.open_design_project_ref = outcome.project_ref
    artifact.export_urls = outcome.export_urls
    db.commit()
    return artifact

def run_matrix(db: Session, brand_id: str, artifact_type: str,
               model_provider_id: str) -> dict:
    brand = db.get(Brand, brand_id)
    root = Path(settings.SHARED_VOLUME_ROOT) / "fixtures" / brand.slug / artifact_type
    cases: dict[str, dict] = {}

    for case_name, per_type in FIXTURE_CASES.items():
        spec = per_type.get(artifact_type)
        if spec is None:
            cases[case_name] = {"passed": True, "skipped": True,
                                "note": f"no {case_name} fixture for {artifact_type}"}
            continue

        work = root / case_name
        artifact = _generate(db, brand, artifact_type, model_provider_id, spec["payload"])
        report = pipeline.run_qa(db, artifact, work / "build-a")

        # PRD 6.2: two consecutive builds of identical input produce identical
        # output. Only the expected case pays for a second build.
        if case_name == "expected":
            rebuild = _generate(db, brand, artifact_type, model_provider_id, spec["payload"])
            report_b_dir = work / "build-b"
            pipeline.run_qa(db, rebuild, report_b_dir)
            pages_a = sorted((work / "build-a").glob("*.jpg"))
            pages_b = sorted(report_b_dir.glob("*.jpg"))
            report["checks_run"].append("determinism")
            report["findings"].extend(f.as_dict() for f in determinism.run(pages_a, pages_b))
            report["passed"] = not any(f["severity"] == "error" for f in report["findings"])

        cases[case_name] = {**report, "item_count": spec["item_count"], "skipped": False}

    return {
        "brand": brand.slug,
        "artifact_type": artifact_type,
        "trusted": all(c.get("passed") for c in cases.values()),
        "cases": cases,
    }
```

- [ ] **Step 7: Write the CLI**

```python
# backend/app/cli.py
"""Dev commands. Not mounted on the API."""
import argparse, json, sys
from sqlalchemy import select

from app.db.session import SessionLocal
from app.db.models import Brand, ModelProvider
from app.services.qa.fixtures import run_matrix

def main() -> int:
    parser = argparse.ArgumentParser(prog="content-studio")
    sub = parser.add_subparsers(dest="command", required=True)
    fixtures = sub.add_parser("fixtures", help="run the fixture matrix for one template")
    fixtures.add_argument("--brand", required=True, help="brand slug")
    fixtures.add_argument("--type", required=True, dest="artifact_type")
    fixtures.add_argument("--model", required=True, help="model provider name")
    args = parser.parse_args()

    with SessionLocal() as db:
        brand = db.scalar(select(Brand).where(Brand.slug == args.brand))
        if brand is None:
            print(f"no brand with slug {args.brand!r}", file=sys.stderr)
            return 2
        provider = db.scalar(select(ModelProvider).where(ModelProvider.name == args.model))
        if provider is None:
            print(f"no model provider named {args.model!r}", file=sys.stderr)
            return 2
        result = run_matrix(db, brand.id, args.artifact_type, provider.id)
    print(json.dumps(result, indent=2))
    return 0 if result["trusted"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `pytest tests/test_slots.py tests/test_fixtures.py -v`
Expected: 14 passed

- [ ] **Step 9: Run the matrix against the real Ladder carousel template**

```bash
docker compose exec api python -m app.cli fixtures --brand ladder --type carousel --model claude
```

Expected: JSON with `"trusted": true`, or a per-case findings list naming exactly what broke. Exit code 1 when untrusted, so this drops into CI unchanged.

- [ ] **Step 10: Commit**

```bash
git add backend/app/services/qa/slots.py backend/app/services/qa/fixtures.py backend/app/cli.py backend/tests/test_slots.py backend/tests/test_fixtures.py
git commit -m "feat: slot cardinality rules and the four-case fixture matrix"
```

### Task 25: Approval state machine

**Files:**
- Create: `backend/app/services/approval.py`
- Modify: `backend/app/api/v1/artifacts.py`
- Modify: `backend/app/api/v1/export.py`
- Test: `backend/tests/test_approval.py`

**Interfaces:**
- Produces: `TRANSITIONS: dict[ArtifactStatus, set[ArtifactStatus]]`; `transition(artifact, to_status, actor) -> None` raising `TransitionError`; routes `POST /api/v1/artifacts/{id}/submit`, `POST /api/v1/artifacts/{id}/approve`, `POST /api/v1/artifacts/{id}/reject`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_approval.py
import pytest
from app.services.approval import transition, TransitionError, TRANSITIONS
from app.db.models import ArtifactStatus as S

def test_ready_can_be_submitted_for_review():
    assert S.IN_REVIEW in TRANSITIONS[S.READY]

def test_qa_failed_cannot_be_submitted_for_review():
    assert S.IN_REVIEW not in TRANSITIONS[S.QA_FAILED]

def test_submitting_a_qa_failed_artifact_is_refused(qa_failed_artifact, admin_user):
    with pytest.raises(TransitionError, match="qa_failed"):
        transition(qa_failed_artifact, S.IN_REVIEW, admin_user)

def test_approval_records_the_approver(ready_artifact_row, admin_user):
    transition(ready_artifact_row, S.IN_REVIEW, admin_user)
    transition(ready_artifact_row, S.APPROVED, admin_user)
    assert ready_artifact_row.approved_by == admin_user.id

def test_member_cannot_approve(client_admin, client_member, ready_artifact):
    client_member.post(f"/api/v1/artifacts/{ready_artifact}/submit")
    assert client_member.post(f"/api/v1/artifacts/{ready_artifact}/approve").status_code == 403

def test_rejection_returns_the_artifact_to_ready(ready_artifact_row, admin_user):
    transition(ready_artifact_row, S.IN_REVIEW, admin_user)
    transition(ready_artifact_row, S.READY, admin_user)
    assert ready_artifact_row.status == S.READY
    assert ready_artifact_row.approved_by is None

def test_approved_is_terminal_except_for_iteration():
    assert TRANSITIONS[S.APPROVED] == set()

def test_final_export_requires_approval(client_admin, ready_artifact, fake_storage):
    r = client_admin.get(f"/api/v1/artifacts/{ready_artifact}/exports?final=true")
    assert r.status_code == 409
    client_admin.post(f"/api/v1/artifacts/{ready_artifact}/submit")
    client_admin.post(f"/api/v1/artifacts/{ready_artifact}/approve")
    assert client_admin.get(
        f"/api/v1/artifacts/{ready_artifact}/exports?final=true").status_code == 200
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_approval.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.approval'`

- [ ] **Step 3: Write the state machine**

```python
# backend/app/services/approval.py
"""Explicit state transitions. PRD 5.6.

Nothing is exportable-as-final until approved, and a qa_failed artifact cannot
enter review at all — the mechanical gate comes before the human one, so a
human is never asked to eyeball a defect a machine already found.
"""
from __future__ import annotations

from app.db.models import Artifact, ArtifactStatus as S, Role, User

class TransitionError(ValueError):
    """The requested transition is not legal from the current state."""

TRANSITIONS: dict[S, set[S]] = {
    S.QUEUED:     {S.GENERATING, S.FAILED},
    S.GENERATING: {S.READY, S.QA_FAILED, S.FAILED},
    S.QA_FAILED:  {S.QUEUED, S.READY},     # re-run qa, or regenerate
    S.READY:      {S.IN_REVIEW, S.QUEUED},
    S.IN_REVIEW:  {S.APPROVED, S.READY},   # approve, or send back
    S.APPROVED:   set(),                   # iterate creates a NEW artifact
    S.FAILED:     {S.QUEUED},
}

def transition(artifact: Artifact, to_status: S, actor: User) -> None:
    allowed = TRANSITIONS.get(artifact.status, set())
    if to_status not in allowed:
        raise TransitionError(
            f"cannot move from {artifact.status} to {to_status}; "
            f"legal next states are {sorted(s.value for s in allowed) or 'none'}")
    if to_status == S.APPROVED:
        if actor.role != Role.ADMIN:
            # PRD 3: approval authority sits with admin in v1. When a named
            # approver role arrives, this is the only line that changes.
            raise TransitionError("approval requires the admin role")
        artifact.approved_by = actor.id
    if to_status == S.READY and artifact.status == S.IN_REVIEW:
        artifact.approved_by = None
    artifact.status = to_status
```

- [ ] **Step 4: Add the routes**

```python
# backend/app/api/v1/artifacts.py  (append)
from app.services.approval import transition, TransitionError
from app.db.models import ArtifactStatus as S

def _move(db: Session, artifact_id: str, to_status: S, actor: User) -> Artifact:
    artifact = get_artifact(db, artifact_id)
    try:
        transition(artifact, to_status, actor)
    except TransitionError as exc:
        code = (status.HTTP_403_FORBIDDEN if "admin role" in str(exc)
                else status.HTTP_409_CONFLICT)
        raise HTTPException(code, str(exc)) from None
    db.commit(); db.refresh(artifact)
    return artifact

@router.post("/{artifact_id}/submit", response_model=ArtifactOut)
def submit_for_review(artifact_id: str, db: Session = Depends(get_db),
                      user: User = Depends(current_user)):
    return _move(db, artifact_id, S.IN_REVIEW, user)

@router.post("/{artifact_id}/approve", response_model=ArtifactOut)
def approve(artifact_id: str, db: Session = Depends(get_db),
            user: User = Depends(current_user)):
    return _move(db, artifact_id, S.APPROVED, user)

@router.post("/{artifact_id}/reject", response_model=ArtifactOut)
def reject(artifact_id: str, db: Session = Depends(get_db),
           user: User = Depends(current_user)):
    return _move(db, artifact_id, S.READY, user)
```

- [ ] **Step 5: Gate final exports**

```python
# backend/app/api/v1/export.py  (modify list_exports)
@router.get("")
def list_exports(artifact_id: str, final: bool = False, db: Session = Depends(get_db),
                 _: User = Depends(current_user)) -> dict[str, str]:
    artifact = get_artifact(db, artifact_id)
    _require_exportable(artifact)
    # PRD 5.6: nothing is exportable-as-final until approved.
    if final and artifact.status != ArtifactStatus.APPROVED:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "artifact must be approved for a final export")
    allowed = ALLOWED_FORMATS[artifact.artifact_type]
    return {fmt: _cache(db, artifact, fmt, url)
            for fmt, url in (artifact.export_urls or {}).items() if fmt in allowed}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pytest tests/test_approval.py -v`
Expected: 8 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/approval.py backend/app/api/v1/artifacts.py backend/app/api/v1/export.py backend/tests/test_approval.py
git commit -m "feat: explicit approval state machine gating final export"
```

### Task 26: Version lineage and variant grouping queries

The columns exist from Task 2 and are populated from Task 12. This task makes them readable.

**Files:**
- Modify: `backend/app/api/v1/artifacts.py`
- Test: `backend/tests/test_lineage.py`

**Interfaces:**
- Produces: `GET /api/v1/artifacts/{artifact_id}/lineage` returning the version chain oldest-first; `GET /api/v1/artifacts/{artifact_id}/variants` returning every sibling in the variant group.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_lineage.py
def test_lineage_returns_the_chain_oldest_first(client_admin, iterated_chain):
    root, mid, leaf = iterated_chain
    ids = [a["id"] for a in client_admin.get(f"/api/v1/artifacts/{leaf}/lineage").json()]
    assert ids == [root, mid, leaf]

def test_lineage_of_a_root_artifact_is_just_itself(client_admin, ready_artifact):
    ids = [a["id"] for a in client_admin.get(f"/api/v1/artifacts/{ready_artifact}/lineage").json()]
    assert ids == [ready_artifact]

def test_versions_increment_down_the_chain(client_admin, iterated_chain):
    _, _, leaf = iterated_chain
    versions = [a["version"] for a in client_admin.get(f"/api/v1/artifacts/{leaf}/lineage").json()]
    assert versions == [1, 2, 3]

def test_variants_returns_every_sibling(client_admin, variant_trio):
    first = variant_trio[0]
    ids = {a["id"] for a in client_admin.get(f"/api/v1/artifacts/{first}/variants").json()}
    assert ids == set(variant_trio)

def test_an_ungrouped_artifact_has_itself_as_its_only_variant(client_admin, ready_artifact):
    ids = [a["id"] for a in client_admin.get(f"/api/v1/artifacts/{ready_artifact}/variants").json()]
    assert ids == [ready_artifact]

def test_a_lineage_cycle_terminates(client_admin, db_session, self_parented_artifact):
    r = client_admin.get(f"/api/v1/artifacts/{self_parented_artifact}/lineage")
    assert r.status_code == 200
    assert len(r.json()) <= 100
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_lineage.py -v`
Expected: FAIL, 404 on the lineage route

- [ ] **Step 3: Write the routes**

```python
# backend/app/api/v1/artifacts.py  (append)
MAX_LINEAGE_DEPTH = 100

@router.get("/{artifact_id}/lineage", response_model=list[ArtifactOut])
def lineage(artifact_id: str, db: Session = Depends(get_db),
            _: User = Depends(current_user)):
    """PRD 5.4: every iteration creates a new version; lineage is preserved."""
    chain: list[Artifact] = []
    seen: set[str] = set()
    node = get_artifact(db, artifact_id)
    while node is not None and node.id not in seen and len(chain) < MAX_LINEAGE_DEPTH:
        chain.append(node)
        seen.add(node.id)
        node = db.get(Artifact, node.parent_artifact_id) if node.parent_artifact_id else None
    return list(reversed(chain))

@router.get("/{artifact_id}/variants", response_model=list[ArtifactOut])
def variants(artifact_id: str, db: Session = Depends(get_db),
             _: User = Depends(current_user)):
    """PRD 5.3: one brief producing N options is the real workflow."""
    artifact = get_artifact(db, artifact_id)
    if not artifact.variant_group_id:
        return [artifact]
    return db.scalars(
        select(Artifact).where(Artifact.variant_group_id == artifact.variant_group_id)
        .order_by(Artifact.created_at)
    ).all()
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pytest tests/test_lineage.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/artifacts.py backend/tests/test_lineage.py
git commit -m "feat: lineage and variant-group queries with cycle protection"
```

### Task 27: Research agent integration

Content Studio becomes the third consumer of the unified research agent contract. (PRD §9)

**Files:**
- Create: `backend/app/services/research_client.py`
- Modify: `backend/app/api/v1/briefs.py`
- Modify: `backend/app/core/config.py` (add `RESEARCH_AGENT_BASE_URL: str = ""`)
- Test: `backend/tests/test_research.py`

**Interfaces:**
- Produces: dataclasses `ResearchInput(query, input_type, user_id, context, output_mode, product, lens_preferences)`, `Thesis(lens, headline, description, statement, supporting_points, score)`, `ResearchResult(winning_thesis, sources, run_id, status)`; `run_research(payload: ResearchInput) -> ResearchResult`; `thesis_to_brief(thesis) -> str`; `ResearchUnavailable`; route `POST /api/v1/briefs/from-research`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_research.py
import pytest
from app.services import research_client as rc

def test_field_names_match_the_ladderflow_contract():
    fields = set(rc.ResearchResult.__dataclass_fields__)
    assert {"winning_thesis", "sources", "run_id", "status"} <= fields
    thesis_fields = set(rc.Thesis.__dataclass_fields__)
    assert {"lens", "headline", "description", "statement",
            "supporting_points", "score"} <= thesis_fields

def test_thesis_becomes_an_editable_brief():
    thesis = rc.Thesis(lens="contrarian", headline="Hiring an AE is an escape",
                       description="Founders hire to leave sales.",
                       statement="Most founders hire their first AE to escape selling.",
                       supporting_points=["Point one.", "Point two."], score=0.8)
    brief = rc.thesis_to_brief(thesis)
    assert "Most founders hire" in brief
    assert "Point one." in brief

def test_a_brief_from_research_records_its_source_and_run_id(client_admin, stub_research):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    r = client_admin.post("/api/v1/briefs/from-research",
                          json={"brand_id": bid, "query": "first AE hire"})
    assert r.status_code == 201
    assert r.json()["source"] == "research_agent"
    assert r.json()["research_run_id"] == "run-1"

def test_a_research_brief_is_never_auto_generated_into_an_artifact(client_admin, stub_research):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    brief_id = client_admin.post("/api/v1/briefs/from-research",
                                 json={"brand_id": bid, "query": "x"}).json()["id"]
    # PRD 5.1: never auto-generate from a pulled thesis without a review step.
    assert client_admin.get(f"/api/v1/artifacts?brand_id={bid}").json() == []

def test_an_unconfigured_research_agent_falls_back_to_manual(client_admin, no_research):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    r = client_admin.post("/api/v1/briefs/from-research",
                          json={"brand_id": bid, "query": "x"})
    assert r.status_code == 503
    assert "manual" in r.json()["detail"]

def test_a_rejected_research_run_surfaces_its_reason(client_admin, rejected_research):
    bid = client_admin.post("/api/v1/brands", json={"name": "Ladder"}).json()["id"]
    r = client_admin.post("/api/v1/briefs/from-research",
                          json={"brand_id": bid, "query": "x"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pytest tests/test_research.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.research_client'`

- [ ] **Step 3: Write the client**

Field names are copied from LadderFlow `version_two/backend/research_agent/models.py`, where `ResearchResult` is documented as "The unified output — both products consume this". Content Studio is the third consumer; do not rename anything.

```python
# backend/app/services/research_client.py
"""Consumer of the unified research agent contract. PRD 9.

The names here mirror LadderFlow's research_agent/models.py exactly. A
divergent field name would be a second integration path in everything but
appearance, which is what PRD 9 forbids.
"""
from __future__ import annotations
from dataclasses import dataclass, field

import httpx
from app.core.config import settings

class ResearchUnavailable(RuntimeError):
    """No research agent is configured or reachable."""

class ResearchRejected(ValueError):
    """The agent ran and declined to produce a thesis."""

@dataclass
class ResearchInput:
    query: str
    input_type: str = "freeform"          # keywords | youtube_url | freeform
    user_id: str = "default"
    context: dict = field(default_factory=dict)
    output_mode: str = "research_report"
    product: str = "content_studio"
    lens_preferences: list[str] | None = None

@dataclass
class Thesis:
    lens: str                              # strategy | signal | execution | contrarian
    headline: str = ""
    description: str = ""
    statement: str = ""
    supporting_points: list[str] = field(default_factory=list)
    score: float = 0.0

@dataclass
class ResearchResult:
    winning_thesis: Thesis | None = None
    sources: list[dict] = field(default_factory=list)
    run_id: str = ""
    status: str = "pending"
    rejection_reason: str | None = None

def run_research(payload: ResearchInput) -> ResearchResult:
    if not settings.RESEARCH_AGENT_BASE_URL:
        # PRD 9: brands without a knowledge graph or live connection fall back
        # to manual-only. Expected, not a bug.
        raise ResearchUnavailable("no research agent configured; briefs are manual-only")
    try:
        with httpx.Client(base_url=settings.RESEARCH_AGENT_BASE_URL, timeout=300) as client:
            response = client.post("/research/run", json=payload.__dict__)
            response.raise_for_status()
            body = response.json()
    except httpx.HTTPError as exc:
        raise ResearchUnavailable(f"research agent unreachable: {exc}") from exc

    raw = body.get("winning_thesis")
    result = ResearchResult(
        winning_thesis=Thesis(**raw) if raw else None,
        sources=list(body.get("sources") or []),
        run_id=str(body.get("run_id") or ""),
        status=str(body.get("status") or "complete"),
        rejection_reason=body.get("rejection_reason"),
    )
    if result.winning_thesis is None:
        raise ResearchRejected(result.rejection_reason or "research produced no thesis")
    return result

def thesis_to_brief(thesis: Thesis) -> str:
    """Render a thesis as a brief the member then edits. PRD 5.1: never
    auto-generate from a pulled thesis without a review step."""
    lines = [thesis.headline or thesis.statement, ""]
    if thesis.statement and thesis.statement != thesis.headline:
        lines += [thesis.statement, ""]
    if thesis.description:
        lines += [thesis.description, ""]
    if thesis.supporting_points:
        lines.append("Supporting points:")
        lines += [f"- {point}" for point in thesis.supporting_points]
    lines += ["", f"(lens: {thesis.lens}, score: {thesis.score:.2f} — edit before generating)"]
    return "\n".join(lines).strip()
```

- [ ] **Step 4: Add the route**

```python
# backend/app/api/v1/briefs.py  (append)
from pydantic import BaseModel
from app.services import research_client as rc

class ResearchBriefRequest(BaseModel):
    brand_id: str
    query: str
    lens_preferences: list[str] | None = None

@router.post("/from-research", response_model=BriefOut,
             status_code=status.HTTP_201_CREATED)
def brief_from_research(payload: ResearchBriefRequest, db: Session = Depends(get_db),
                        user: User = Depends(current_user)):
    get_brand(db, payload.brand_id)
    try:
        result = rc.run_research(rc.ResearchInput(
            query=payload.query, user_id=user.id,
            lens_preferences=payload.lens_preferences))
    except rc.ResearchUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
    except rc.ResearchRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None

    brief = Brief(brand_id=payload.brand_id, created_by=user.id,
                  source="research_agent",
                  content=rc.thesis_to_brief(result.winning_thesis),
                  research_run_id=result.run_id)
    db.add(brief); db.commit(); db.refresh(brief)
    return brief
```

Add the missing imports at the top of `briefs.py`: `HTTPException`, `status`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pytest tests/test_research.py -v`
Expected: 6 passed

- [ ] **Step 6: Run the whole suite**

Run: `pytest -v`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/research_client.py backend/app/api/v1/briefs.py backend/app/core/config.py backend/tests/test_research.py
git commit -m "feat: research agent brief pre-fill with manual fallback"
```

---

## Self-Review

**Spec coverage.** Every PRD section maps to a task:

| PRD | Task |
|---|---|
| §2 scope table, format allowlist | 12, 14 |
| §2 out of scope (documents, publishing, multi-org, per-brand permissions) | Global Constraints; 2 (one org row), 4 (every member every brand) |
| §3 roles, admin approval | 3, 25 |
| §4.1 DESIGN.md | 5, 7 |
| §4.2 VOICE.md + AI tells | 5, 9 |
| §4.3 references, scope/role, PPTX extraction | 16, 17, 20 |
| §4.4 assets, fonts P0 | 7, 15, 20 |
| §5.1 brief, research pre-fill | 10, 27 |
| §5.2 copy stage + approval before design | 9, 10 |
| §5.3 design call, model choice, variants | 12, 18, 20 |
| §5.4 iteration, lineage | 12, 26 |
| §5.5 QA gate | 21, 22, 23 |
| §5.6 approval | 25 |
| §5.7 export | 14 |
| §6.1 verification loop | 21, 23 |
| §6.2 seven automated checks | 22, 24 (determinism) |
| §6.3 fixture matrix, slot cardinality | 24 |
| §6.4 Hallmark scoping, `image` forbidden | 2, 19, 20 |
| §7.1 async, durable, reconnectable, concurrency | 11, 12, 13 |
| §7.2 filesystem coupling | 7, 1 (compose volume) |
| §7.3 sandboxing / per-brand isolation | 7 (`brand_root`), 6 (key prefixes) |
| §7.4 swappability | 8 |
| §8 data model | 2 |
| §9 research agent | 27 |
| §10 open questions | 0 |
| §11 phasing | Phase headings |
| §12 first work item | 0 step 2 |

**Deliberate deferrals.** Two things PRD §11 lists under "Later, not now" are intentionally absent: the design-system wizard and the per-brand permission UI. `BrandAccess` exists as a table with no route. Cost governance (OQ7) has no dashboard, per §10.

**Placeholder scan.** The three `# filled in by Task 20` markers in Task 12 are closed by Task 20. `_run_qa`'s placeholder in Task 12 is replaced in Task 23. No other TODOs remain.

**Type consistency.** `GenerationRequest` field names are identical in Tasks 8, 12 and 20. `Finding` is defined once in `checks/__init__.py` and imported everywhere. `ArtifactStatus` is aliased as `S` only inside `approval.py` and the approval tests. `references_for` and `skills_for` keep the same signatures in Tasks 17/19 and their Task 20 call sites.

---

## Execution Handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session with checkpoints. Use `superpowers:executing-plans`.

**Do not start Phase 1 until Task 0 returns `GO`.**
