"""Supabase Storage wrapper. The only module that knows the bucket exists.

Files never live in Postgres: Storage ships with the Supabase project already
in the stack, so it adds no service and no bill, and it hands the browser a
signed URL a bytea column cannot.
"""

from __future__ import annotations

import re
import uuid
from functools import lru_cache

from supabase import Client, create_client

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


def _sign(key: str, expires_seconds: int) -> str:
    return _bucket().create_signed_url(key, expires_seconds)["signedURL"]


def put(key: str, data: bytes, content_type: str) -> str:
    _put_bytes(key, data, content_type)
    return key


def get(key: str) -> bytes:
    return _get_bytes(key)


def delete(key: str) -> None:
    _remove(key)


def signed_url(key: str, expires_seconds: int = 3600) -> str:
    return _sign(key, expires_seconds)
