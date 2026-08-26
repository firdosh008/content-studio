"""The single seam to open-design.

PRD 7.4: this category is young. Everything open-design-shaped is confined to
this file so replacing it is an integration swap, not a rewrite. Nothing here
leaks into the schema, the API, or the QA gate.

The three paths below are placeholders until Phase 0 confirms them against a
running daemon. When they change, they change HERE and nowhere else.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.core.config import settings

# Swapped by tests; None in production.
_transport_for_tests: httpx.MockTransport | None = None

GENERATE_PATH = "/api/generate"
CHAT_PATH = "/api/chat"
COMPLETE_PATH = "/api/complete"


class OpenDesignError(RuntimeError):
    """The daemon could not be reached, or refused the request."""


@dataclass
class GenerationRequest:
    brand_slug: str
    artifact_type: str
    mode: str  # code | image
    copy_text: str
    design_md: str
    reference_specs: list[str] = field(default_factory=list)
    asset_paths: list[str] = field(default_factory=list)
    skill_paths: list[str] = field(default_factory=list)
    model_name: str = ""
    variant_index: int = 0


@dataclass
class GenerationOutcome:
    project_ref: str
    export_urls: dict[str, str]
    log: str


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.OPEN_DESIGN_BASE_URL,
        timeout=settings.OPEN_DESIGN_TIMEOUT_SECONDS,
        transport=_transport_for_tests,
    )


def _post(path: str, payload: dict) -> GenerationOutcome:
    try:
        with _client() as client:
            response = client.post(path, json=payload)
    except httpx.HTTPError as exc:
        raise OpenDesignError(f"open-design unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise OpenDesignError(
            f"open-design returned {response.status_code}: {response.text[:400]}"
        )
    body = response.json()
    return GenerationOutcome(
        project_ref=str(body.get("projectId") or ""),
        export_urls=dict(body.get("exports") or {}),
        log=str(body.get("log") or ""),
    )


def generate(req: GenerationRequest) -> GenerationOutcome:
    return _post(
        GENERATE_PATH,
        {
            "designSystem": req.brand_slug,
            "type": req.artifact_type,
            "mode": req.mode,
            "content": req.copy_text,
            "designMarkdown": req.design_md,
            "references": req.reference_specs,
            "assets": req.asset_paths,
            "skills": req.skill_paths,
            "model": req.model_name,
            "variant": req.variant_index,
        },
    )


def edit(project_ref: str, instruction: str) -> GenerationOutcome:
    """PRD 5.4: proxy to the existing conversational edit loop.

    Works for both generation modes.
    """
    return _post(CHAT_PATH, {"projectId": project_ref, "message": instruction})


def complete(model: str, system: str, prompt: str) -> str:
    """One text completion through open-design's BYOK proxy.

    Used by the copy stage, which needs a model but no design system.
    """
    try:
        with _client() as client:
            response = client.post(
                COMPLETE_PATH,
                json={"model": model, "system": system, "prompt": prompt},
            )
    except httpx.HTTPError as exc:
        raise OpenDesignError(f"open-design unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise OpenDesignError(
            f"open-design returned {response.status_code}: {response.text[:400]}"
        )
    return str(response.json().get("text") or "").strip()


def download_export(url: str) -> bytes:
    try:
        with _client() as client:
            response = client.get(url)
            response.raise_for_status()
            return response.content
    except httpx.HTTPError as exc:
        raise OpenDesignError(f"export download failed: {exc}") from exc
