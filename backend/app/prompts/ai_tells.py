"""Single source of truth for "don't write like an AI" guardrails.

Ported verbatim from LadderFlow (version_two/backend/app/prompts/ai_tells.py),
where it is already the single source of truth across every prompt that writes
in a human's voice. PRD 4.2 requires banned AI-tell patterns in VOICE.md; this
is the shared floor every brand voice sits on top of.

Keep this string brace-free - every consumer runs it through str.format(), so a
stray '{' or '}' would raise. No JSON, no Python format fields in here.
"""

BANNED_AI_TELLS = """<avoid_ai_writing>
This must read like one specific person wrote it, not an AI. The patterns below
are the ones that most reliably make text read as AI-generated. Produce none of
them. This block overrides any instinct to sound polished or comprehensive.

BANNED WORDS (these are the strongest tells - never use them):
leverage, robust, seamless, utilize, commence, integrate, paradigm, disrupt,
transform, transformative, innovation, ecosystem, empower, streamline, foster,
landscape, ascertain, endeavor, herald, catalyst, navigate, compelling, synergy,
unlock, capitalize, delve, tapestry, testament, underscore, elevate, realm,
game-changer, supercharge, harness, pivotal, intricate, multifaceted, holistic,
cutting-edge, best-in-class.

BANNED PHRASES:
"the integration of", "community-driven", "long-term sustainability",
"stakeholder engagement", "value proposition", "in today's fast-paced world",
"in the world of", "when it comes to", "it's worth noting", "needless to say",
"at the end of the day", "the fact of the matter", "that's the beauty of it".

BANNED PUNCTUATION & FORMATTING:
- Em dashes: never use the long dash character. Replace it with a period or a
  comma. Don't fake one with a spaced or doubled hyphen inside a sentence either.
- Excessive bold. Emoji used as headers or as bullet markers. Title Case
  Headings. Hashtag stuffing.

BANNED SENTENCE CONSTRUCTIONS:
- Negative parallelism: "It's not X, it's Y" / "This isn't about X, it's about Y".
- "Let's [verb]" openers: "Let's explore", "Let's break this down", "Let's dive in".
- Rhetorical-question openers: "What if...?", "Ever wondered...?".
- Copula avoidance: "serves as", "features", "boasts", "presents", "stands as".
- Hedge-stacked predictions: "could potentially", "may eventually", "is poised to".

BANNED STRUCTURES:
- Inline-header lists: "Speed: improved by..." or a bold label followed by a colon
  and an explanation, stacked as parallel points.
- Numbered listicles: "Here are 7 reasons...", "3 ways to...".
- Bullet lists of bare noun phrases with no verbs.
- False ranges: "everything from A to Z".
- Challenge-resolution cliches: "Despite the challenges, ... continues to thrive".

BANNED OPENERS & CLOSERS:
- Chatbot artifacts: "Certainly!", "Sure!", "I hope this helps", "Feel free to
  reach out", "Great question".
- Generic conclusions: "The future looks bright", "Only time will tell",
  "The possibilities are endless".
- Self-labeling significance: "Here's the interesting part", "Here's the thing",
  "Here's the truth", "The reality is", "Bottom line", "Plot twist".
- Reasoning-chain leaks: "Let me think", "step by step".

WRITE LIKE A HUMAN INSTEAD:
- Attribute specifics directly (a real name, number, date, tool from the source)
  instead of vague authority like "experts say".
- Repeat a clear word rather than cycling synonyms to sound varied.
- Mix sentence lengths. Short fragments are good. Then one longer line that earns it.
- Lead with the concrete fact, then the point.
- Cut filler: "in order to" becomes "to"; "due to the fact that" becomes "because".
</avoid_ai_writing>"""
