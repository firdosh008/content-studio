"""Copy is generated against VOICE.md and approved before design begins.

PRD 5.2: if the layout agent writes the words in the same pass, the words get
shaped to fill boxes. For B2B the words are the differentiator, so this stage
is separate on purpose.
"""

from __future__ import annotations

from app.prompts.ai_tells import BANNED_AI_TELLS
from app.prompts.copy_prompt import COPY_SYSTEM, COPY_TEMPLATE
from app.services import open_design as od


def build_copy_prompt(brief: str, voice_md: str, artifact_type: str) -> str:
    if not (voice_md or "").strip():
        raise ValueError(
            "brand has no VOICE.md; author it before generating copy"
        )
    return COPY_TEMPLATE.format(
        voice_md=voice_md.strip(),
        ai_tells=BANNED_AI_TELLS,
        artifact_type=artifact_type,
        brief=brief.strip(),
    )


def generate_copy(
    brief: str, voice_md: str, artifact_type: str, model_name: str
) -> str:
    """One call to the selected coding-agent provider via open-design's proxy."""
    prompt = build_copy_prompt(brief, voice_md, artifact_type)
    return od.complete(model=model_name, system=COPY_SYSTEM, prompt=prompt)
