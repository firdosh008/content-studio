"""Supabase-backed identity.

Tokens are verified against Supabase's published JWKS, so there is no shared
secret in our env and key rotation costs nothing.
"""

from __future__ import annotations

from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Role, User
from app.db.session import get_db

LADDER_ORG_ID = "00000000-0000-0000-0000-000000000001"

_bearer = HTTPBearer()


@lru_cache(maxsize=1)
def _jwks() -> PyJWKClient:
    return PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=["RS256", "ES256"],
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
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "token missing sub or email"
        )

    user = db.scalar(select(User).where(User.auth_ref == sub))
    if user is None:
        user = User(
            organization_id=LADDER_ORG_ID,
            email=email,
            auth_ref=sub,
            role=Role.MEMBER,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user
