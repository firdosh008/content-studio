import pytest

from app.prompts.ai_tells import BANNED_AI_TELLS
from app.services import copy_gen


def test_prompt_carries_the_voice_contract():
    prompt = copy_gen.build_copy_prompt("launch post", "# Voice\nBlunt.", "social_post")
    assert "Blunt." in prompt


def test_prompt_carries_the_ai_tell_guardrails():
    prompt = copy_gen.build_copy_prompt("launch post", "# Voice", "carousel")
    assert BANNED_AI_TELLS in prompt


def test_prompt_names_the_artifact_type():
    assert "deck" in copy_gen.build_copy_prompt("x", "# Voice", "deck")


def test_prompt_carries_the_brief():
    assert "launch the thing" in copy_gen.build_copy_prompt(
        "launch the thing", "# Voice", "deck"
    )


def test_empty_voice_is_refused():
    with pytest.raises(ValueError, match="VOICE.md"):
        copy_gen.build_copy_prompt("x", "   ", "deck")


def test_ai_tells_string_is_brace_free():
    assert "{" not in BANNED_AI_TELLS
    assert "}" not in BANNED_AI_TELLS
