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
