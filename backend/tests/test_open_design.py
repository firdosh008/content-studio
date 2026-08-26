import httpx
import pytest

from app.services import open_design as od


def _request() -> od.GenerationRequest:
    return od.GenerationRequest(
        brand_slug="ladder",
        artifact_type="carousel",
        mode="code",
        copy_text="hello",
        design_md="# Ladder",
        model_name="claude",
    )


def test_generate_returns_project_ref_and_exports(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/generate"
        return httpx.Response(
            200,
            json={
                "projectId": "proj_42",
                "exports": {"png": "http://od/e/1.png"},
                "log": "done",
            },
        )

    monkeypatch.setattr(od, "_transport_for_tests", httpx.MockTransport(handler))
    outcome = od.generate(_request())
    assert outcome.project_ref == "proj_42"
    assert outcome.export_urls == {"png": "http://od/e/1.png"}


def test_generate_raises_a_typed_error_on_daemon_failure(monkeypatch):
    monkeypatch.setattr(
        od,
        "_transport_for_tests",
        httpx.MockTransport(lambda r: httpx.Response(500, text="boom")),
    )
    with pytest.raises(od.OpenDesignError) as exc:
        od.generate(_request())
    assert "500" in str(exc.value)


def test_generate_raises_a_typed_error_when_unreachable(monkeypatch):
    def refuse(_request):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(od, "_transport_for_tests", httpx.MockTransport(refuse))
    with pytest.raises(od.OpenDesignError, match="unreachable"):
        od.generate(_request())


def test_edit_posts_the_instruction_to_chat(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(
            200, json={"projectId": "proj_42", "exports": {}, "log": ""}
        )

    monkeypatch.setattr(od, "_transport_for_tests", httpx.MockTransport(handler))
    od.edit("proj_42", "make the headline bigger")
    assert seen["path"] == "/api/chat"
