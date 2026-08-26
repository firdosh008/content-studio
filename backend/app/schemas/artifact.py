from datetime import datetime

from pydantic import BaseModel, Field

MAX_VARIANTS = 8


class ArtifactCreate(BaseModel):
    model_config = {"protected_namespaces": ()}

    brand_id: str
    brief_id: str
    copy_id: str | None = None
    artifact_type: str
    model_provider_id: str
    variants: int = Field(default=1, ge=1, le=MAX_VARIANTS)


class IterateRequest(BaseModel):
    instruction: str = Field(min_length=1)


class ArtifactOut(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

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
