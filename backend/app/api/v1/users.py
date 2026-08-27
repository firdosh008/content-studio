from fastapi import APIRouter, Depends

from app.core.security import current_user
from app.db.models import User

router = APIRouter(tags=["users"])


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}
