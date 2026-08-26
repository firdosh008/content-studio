from datetime import datetime

from pydantic import BaseModel


class ContractIn(BaseModel):
    content: str


class ContractOut(BaseModel):
    content: str
    version: int
    updated_at: datetime | None = None
