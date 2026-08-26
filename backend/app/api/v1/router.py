from fastapi import APIRouter

from app.api.v1 import brands, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(users.router)
api_router.include_router(brands.router)
