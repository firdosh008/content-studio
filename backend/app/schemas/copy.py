from datetime import datetime

from pydantic import BaseModel, model_validator


class CopyCreate(BaseModel):
    generate: bool = False
    content: str | None = None
    model_provider_id: str | None = None
    artifact_type: str = "social_post"

    model_config = {"protected_namespaces": ()}

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
