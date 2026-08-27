from fastapi import APIRouter

from app.api.v1 import (
    artifacts,
    brands,
    briefs,
    contracts,
    copy,
    export,
    jobs,
    users,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(users.router)
api_router.include_router(brands.router)
api_router.include_router(contracts.router)
api_router.include_router(briefs.router)
api_router.include_router(copy.router)
api_router.include_router(artifacts.router)
api_router.include_router(jobs.router)
api_router.include_router(export.router)
