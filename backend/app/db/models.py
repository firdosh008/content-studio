"""Every table in PRD section 8. No more."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
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
    auth_ref: Mapped[str] = mapped_column(String(128), unique=True)
    role: Mapped[Role] = mapped_column(String(16), default=Role.MEMBER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Brand(Base):
    __tablename__ = "brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DesignSystem(Base):
    __tablename__ = "design_systems"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    design_md_content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class BrandVoice(Base):
    __tablename__ = "brand_voices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    voice_md_content: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class BrandReference(Base):
    __tablename__ = "brand_references"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    file_ref: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(16))  # image | pptx
    scope: Mapped[ReferenceScope] = mapped_column(String(16))
    role: Mapped[ReferenceRole] = mapped_column(String(24))
    extracted_layout_spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
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
    """Schema only. No UI in v1 - every member gets every brand. PRD 2."""

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
    uploaded_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    storage_ref: Mapped[str] = mapped_column(String(500))
    applies_to: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    @validates("applies_to")
    def _forbid_image(self, _key: str, value: list[str]) -> list[str]:
        """PRD 6.4: Hallmark needs a coding agent; image-mode has none.

        Enforced here so admin discipline is not the control.
        """
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
    source: Mapped[str] = mapped_column(String(24), default="manual")
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
    generated_by_model_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_providers.id"), nullable=True
    )
    approved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
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
    status: Mapped[ArtifactStatus] = mapped_column(
        String(24), default=ArtifactStatus.QUEUED
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_artifact_id: Mapped[str | None] = mapped_column(
        ForeignKey("artifacts.id"), nullable=True
    )
    variant_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    open_design_project_ref: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )
    export_urls: Mapped[dict] = mapped_column(JSON, default=dict)
    qa_report: Mapped[dict] = mapped_column(JSON, default=dict)
    edit_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class GenerationJob(Base):
    __tablename__ = "generation_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    state: Mapped[JobState] = mapped_column(String(16), default=JobState.QUEUED)
    progress_ref: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
