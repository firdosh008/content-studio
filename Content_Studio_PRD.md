# Content Studio — PRD (v2)

**Working title only — pick a real name before build.** Avoid "Studio" alone; Ladder Brief already has a page called that, and this is a fully separate application.

**Author:** Shiv
**Status:** Locked for build
**Supersedes:** Content Studio PRD v1

---

## 1. Overview

A standalone web app for producing **on-brand generative visual content** — social posts, carousels, presentation decks, single-pagers/lead magnets, and standalone images — across multiple brand accounts (Ladder, Agent Loopr, personal brand, future client brands) from one login.

**The problem it solves.** Brand and content work today is fragmented across Figma, Canva, GPT-image and a separate copywriter, with nothing tying brand identity to content output. No single tool owns "brand system + copy + visual artifact" end to end for B2B SaaS work. This tool is a bet that a unified space is the better answer.

**How it works.** The app is a product layer over a self-hosted [open-design](https://github.com/nexu-io/open-design) instance, which does the generation. open-design has two pathways this app exposes:

- **Code-mode** — a coding agent (Claude, Kimi, Codex, or any BYOK model) writes HTML/CSS, exported to PNG/PDF/PPTX. Drives posts, carousels, decks, single-pagers.
- **Image-mode** — a direct image-model call (`gpt-image-2`, Seedream, Nano Banana, MiniMax, ImageRouter, custom). Drives standalone images.

The app adds what open-design has none of: multi-user accounts, per-brand governance (visual system, voice, references, assets), a copy stage, an approval workflow, a job queue, and a mechanical QA gate.

---

## 2. Scope

### In scope — generative visual only

| Artifact type | Mode | Primary export |
|---|---|---|
| Social post (single image/graphic) | code | PNG |
| Carousel | code | PNG per card, ZIP |
| Deck | code | PPTX, PDF |
| Single-pager / lead magnet | code | PDF, HTML |
| Image | image | PNG, JPG |

### Explicitly out of scope — structured documents

**Contracts, proposals, SOWs, reports and any other structured document are NOT built here.** They belong in **CIOS**, which already has a template-based document renderer in progress (Rishabh owns it).

This split is deliberate and load-bearing. Structured documents are a different artifact class: the words carry legal and commercial risk, layout is secondary, and creative interpretation is a defect rather than a feature. They need deterministic templating with a clause library and merge fields — not agentic generation. Do not let document generation leak into this tool later because it "feels close." If a request needs a contract, it goes to CIOS.

### Other non-goals (v1)

- **No publishing or scheduling.** Output is exported; posting is manual. If this is ever wanted, check LadderFlow v2.0's content-posting PRD first rather than building a second implementation.
- **No design-system wizard.** Admins paste `DESIGN.md` / `VOICE.md` directly. Guided brand setup (logo upload, palette extraction, questionnaire) is later.
- **No multi-organization support and no external/client logins.** Single shared workspace, Ladder team only. The schema keeps the door open (§8) — no org-switching UI, invite flow, or per-org isolation logic gets built now.
- **No per-brand permission UI.** `BrandAccess` exists in the schema; the UI gives every member every brand for now.
- **No Hallmark on carousels, decks or images.** See §6.4.
- **Not integrated into Ladder Brief's auth or infrastructure.** Separate app, separate database, separate accounts.

---

## 3. Users & roles

- **Admin** (Shiv) — manages brands, brand contracts, references, assets, skills, models, and users.
- **Member** (social media manager, copywriter) — creates content: picks a brand, produces copy, generates artifacts, iterates, submits for approval, exports.

Approval authority sits with admin in v1. Design the model so it can move to a named approver role later.

---

## 4. Brand governance — the four contracts

Every brand carries four things. Output quality is determined far more by these than by the engine, so treat authoring them as real work, not setup.

### 4.1 `DESIGN.md` — visual contract
Palette, type scale, spacing rhythm, component conventions, layout principles. open-design's native format, read off disk per generation.

### 4.2 `VOICE.md` — verbal contract
Tone, vocabulary, point of view, sentence rhythm, banned constructions. This has no equivalent in open-design and is the single most important addition in v2 — without it, copy is generic regardless of how good the design system is.

Must capture, at minimum: what the brand sounds like, what it never says, claim-substantiation rules (no asserted adjectives without something concrete behind them), and banned AI-tell patterns.

**Reuse note:** LadderFlow already generates written content against brand voice. Do not invent a second, divergent voice format — align with whatever LadderFlow uses, or deliberately converge them.

### 4.3 Reference library — tagged visual references
Uploaded screenshots (Figma exports, Pinterest captures, competitor work) and `.pptx` files. The user **tags** rather than describes; the agent's vision does the interpreting at generation time.

Each reference carries:
- **Scope** — `social` | `presentation` | `both`
- **Role** — `layout` | `typography` | `colour_gradient` | `overall_vibe`

Only references matching the artifact type's scope are included in a given generation. This is what lets "social vibe" and "presentation vibe" coexist per brand without bleeding into each other.

**PPTX references get parsed, not just viewed.** A `.pptx` is a ZIP of XML with machine-readable geometry — shape positions, sizes, fonts, colours, master layouts. Extract that into a text layout spec at upload time (python-pptx or direct XML) and store it alongside the file. This is meaningfully higher fidelity than an agent eyeballing a screenshot. **This extraction is Content Studio's job — open-design exports PPTX but there is no evidence it ingests one.**

**Expectation to set with users:** references produce consistent brand feel, not pixel-exact template reproduction. This is a generative system taking direction. If an asset genuinely must be identical every run, it does not belong in this tool.

### 4.4 Asset library — real files
Logos (multiple lockups/formats), headshots, product screenshots, icons, **and licensed font files**.

Generated artifacts must inject real assets. An AI-approximated logo is never acceptable output.

**Fonts are P0, not a nice-to-have.** Brand font files must be self-hosted inside the open-design container, never resolved from the host OS. Without this, typography silently falls back, brand systems become decorative, and output differs between machines — which also makes regression testing impossible. This is the same failure mode as D6 in the CIOS renderer review.

---

## 5. The pipeline

```
Brief  →  Copy  →  Design  →  QA gate  →  Approval  →  Export
         (VOICE)   (DESIGN +
                    refs +
                    assets)
```

### 5.1 Brief
Manual entry by default. Optionally pull a `WinningThesis` from the unified research agent (§9), pre-filling the brief for the member to edit. Never auto-generate from a pulled thesis without a review step.

### 5.2 Copy — a separate, reviewed stage
Copy is generated against the brand's `VOICE.md` and **approved before design begins**. The design agent consumes approved copy; it does not write it.

Rationale: if the layout agent writes the words in the same pass, the words get shaped to fill boxes. For B2B, the words are the differentiator. This separation is the point.

A member may also skip generation and write/paste copy directly — that path must exist and must be first-class, not a fallback.

### 5.3 Design
The app calls open-design with: approved copy + `DESIGN.md` + scope-matched references (including extracted PPTX layout specs) + brand assets + any skills scoped to that artifact type + the selected model.

Members select the model per generation from what admin has enabled. Members may request **variants** — one brief producing N options is the real workflow, not an edge case.

### 5.4 Iteration
Follow-up edit instructions proxy to open-design's existing conversational edit loop (`/api/chat`), which works for both modes. No canvas, no drag-editing — accepted tradeoff for this artifact class. Every iteration creates a new version; lineage is preserved.

### 5.5 QA gate
See §6.

### 5.6 Approval
Explicit state transition. Nothing is exportable-as-final until approved.

### 5.7 Export
Per §2 table. Export surfaces open-design's existing pipeline output as a download.

---

## 6. Quality assurance

### 6.1 The verification loop — ported from the CIOS renderer review

This is the QA gate. It is mechanical, runs on every generation, and does not depend on any third-party slop detector.

```
1. Generate the artifact
2. Validate structurally   — schema / relationship / content-type checks
                             (P0 for PPTX: catches corrupt-file cases before a client sees them)
3. Convert to PDF          — headless LibreOffice for PPTX
4. Rasterise the pages     — pdftoppm -jpeg -r 100
5. Inspect the images      — automated checks, then human review
6. Fix and repeat
```

Reading a text layer is not a review. Every layout defect is invisible there.

### 6.2 Automated checks

Run against rasterised output; these catch the defect classes without human inspection:

- No text overflows its container or card boundary
- No identifier, date, price or numeric token is broken across lines
- No card or slide is less than a defined fill threshold (dead space)
- No element sits outside the canvas bounds
- Brand palette compliance — no colours outside the declared tokens beyond a tolerance
- Declared brand fonts are the fonts actually rendered (catches silent fallback)
- Two consecutive builds of identical input produce identical output

### 6.3 Fixture matrix

Every brand template gets rendered against four content payloads before it is trusted:

| Case | What it tests |
|---|---|
| **Minimum** | A 5-card carousel given 1 item. A deck with 2 slides |
| **Expected** | The content volume the template was designed around |
| **Maximum** | A 5-card carousel given 12 items. A 40-slide deck |
| **Pathological** | A 200-character headline. A 40-character unbroken string. An empty optional section. A single-item list |

**Template slots are not source items.** A layout showing five cards given three items must drop the entire card group, not empty its text — an emptied card is a hole. Every slot declares cardinality (`1`, `1..n`, `0..n`) and an overflow policy: reflow → rebalance → scale within a floor → promote to a layout variant → continue to a second block. Never silently clip, never leave dead space, and error loudly rather than render something broken.

### 6.4 Hallmark — scoped, and why

[Hallmark](https://github.com/nutlope/hallmark) is a generation-time anti-slop skill: a `SKILL.md` read by the coding agent while it generates, applying a rule set and self-critique gates.

**It applies only to prototype/web-page-shaped artifact types.** It does not apply to carousels, decks or images.

For images this is structural, not a gap: Hallmark works by instructing a coding agent, and image-mode has no coding agent in the loop. `image` must be excluded from the allowed values of `applies_to` at the schema level (§8) — enforced in code, not by admin discipline.

For carousels and decks, §6.1–6.3 is the quality mechanism. Do not go shopping for a third-party equivalent.

---

## 7. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Content Studio (standalone)                          │
│  ───────────────────────────────────────────────      │
│  Auth · Brands · DESIGN.md · VOICE.md ·               │
│  Reference library (+ PPTX extraction) ·              │
│  Asset library · Skills · Models ·                    │
│  Copy stage · Job queue · Versions/variants ·         │
│  QA loop · Approval · Export links                    │
└──────────────────┬───────────────────────────────────┘
                    │ HTTP daemon API / CLI (--json)
                    │ + shared volume (filesystem writes)
                    ▼
┌──────────────────────────────────────────────────────┐
│  Self-hosted open-design (Docker)                     │
│  ───────────────────────────────────────────────      │
│  Coding-agent spawn · DESIGN.md application ·         │
│  skill loading · template rendering ·                 │
│  conversational edit loop · image-mode ·              │
│  HTML/PDF/PPTX/PNG export                             │
└──────────────────────────────────────────────────────┘
```

### 7.1 Generation is asynchronous — this is an architectural constraint

Agentic generation of a deck takes minutes. Treating generation as request/response will break the tool the first time someone closes a laptop.

- Durable job queue with persisted state
- Reconnectable progress streams — a member can leave and come back
- Jobs survive app restarts
- Explicit handling of concurrency: **a single open-design daemon will serialise work.** Decide early whether to queue, run multiple daemon instances, or cap concurrent generations. Two people generating simultaneously is a day-one scenario, not a scaling problem.

### 7.2 Filesystem coupling

Design-system writes are **filesystem-only** — confirmed. open-design's docs describe adding a design system as dropping a `DESIGN.md` folder; the daemon reads it off disk per generation. There is a `GET` for listing but no documented create/update endpoint.

So the app and the open-design container run on the same host with a shared volume, and the app writes `design-systems/<brand>/DESIGN.md` directly. Brand assets and fonts land the same way.

### 7.3 Sandboxing

Coding agents execute code. Running that as shared infrastructure across brands — and eventually client brands — is off-label use of a local-first tool. Enforce per-brand project isolation on the filesystem, and treat the generation host as untrusted-code territory when deciding what else runs on it.

### 7.4 Keeping open-design swappable

This category is four months old; today's leader may not be next year's. Coupling stays thin: open-design appears only as opaque references (`open_design_project_ref`, export URLs) and never as structural concepts inside the schema. If it needs replacing, that is a contained integration swap, not a rewrite. Protect this deliberately.

---

## 8. Data model

**The `Organization` entity is the multi-tenancy seam.** v1 seeds exactly one row ("Ladder"); nothing in the UI creates or switches orgs. Cost: one table plus an FK. Payoff: a future client workspace is "add a row and build an invite flow," not a schema retrofit.

```
Organization        -- v1: one row. No UI to create more.
  id, name, created_at

User
  id, organization_id (FK), email, auth_ref, role (admin|member), created_at

Brand
  id, organization_id (FK), name, created_by, created_at

DesignSystem
  id, brand_id (FK), design_md_content, version, created_at, updated_at

BrandVoice
  id, brand_id (FK), voice_md_content, version, created_at, updated_at

BrandReference
  id, brand_id (FK), file_ref, file_type (image|pptx),
  scope (social|presentation|both), role (layout|typography|colour_gradient|overall_vibe),
  extracted_layout_spec (text, nullable — populated for pptx),
  uploaded_by (FK User), created_at

BrandAsset
  id, brand_id (FK), asset_type (logo|font|headshot|screenshot|icon),
  file_ref, label, created_at

BrandAccess         -- schema only, no UI in v1
  id, user_id (FK), brand_id (FK)

ModelProvider
  id, organization_id (FK), type (coding_agent|image_provider), name,
  credential_ref (secure), enabled, created_at

Skill
  id, organization_id (FK), name, uploaded_by (FK User), storage_ref,
  applies_to (array of artifact_type — `image` NOT permitted, enforced at write),
  enabled, created_at

Brief
  id, brand_id (FK), created_by (FK User), source (manual|research_agent),
  content, research_run_id (nullable), created_at

Copy
  id, brief_id (FK), brand_id (FK), content,
  status (draft|approved), generated_by_model_id (FK ModelProvider, nullable —
  null when written by hand), approved_by (FK User, nullable),
  version, created_by (FK User), created_at

Artifact
  id, brand_id (FK), brief_id (FK), copy_id (FK),
  artifact_type (social_post|carousel|deck|single_pager|image),
  generation_mode (code|image), model_provider_id (FK ModelProvider),
  status (queued|generating|ready|qa_failed|in_review|approved|failed),
  version, parent_artifact_id (nullable — iteration lineage),
  variant_group_id (nullable — N options from one brief),
  open_design_project_ref, export_urls (jsonb),
  qa_report (jsonb — automated check results),
  created_by (FK User), approved_by (FK User, nullable),
  created_at, updated_at

GenerationJob
  id, artifact_id (FK), state (queued|running|succeeded|failed),
  progress_ref, started_at, finished_at, error (nullable)
```

---

## 9. Integration: unified research agent

Content Studio becomes the third consumer of the unified research agent, alongside LadderFlow and Ladder Brief.

- Call the same `run_research(...)` contract; consume the same `ResearchResult` / `WinningThesis` object. Do not build a second integration path.
- Pre-fill the brief; the member edits before anything proceeds.
- Brands without a knowledge graph or live connection fall back to manual-only. Expected, not a bug.

---

## 10. Open questions — resolve before or early in build

1. **PPTX export: direct OOXML generation or conversion?** *(highest stakes, test first)* If open-design produces decks by converting HTML rather than generating OOXML, clients receive a file full of text boxes instead of an editable deck. For B2B pitch decks that is close to disqualifying. Generate one deck, open it in PowerPoint, try to edit a text block. Answer this before writing wrapper code.
2. **Image-mode reference path.** Image-to-image works (`--image ref.png`) and multiple references are supported, but there was a bug where `gpt-image-*` edits failed on an unsupported `response_format` parameter. A later release claims broader compatibility. Smoke-test on your instance before designing around it.
3. **Figma import.** open-design claims it can turn a `.fig` file or live site into a reusable design system. Given Figma templates already exist for Ladder and Agent Loopr, test this before hand-authoring `DESIGN.md` from screenshots — it may be a much shorter path.
4. **Kimi reachability.** Is Kimi available through open-design's OpenAI-compatible BYOK proxy (`baseUrl` + key, no install), or does it need a CLI on the host? Determines how trivial "admin adds a model" is per provider.
5. **Coding-agent vision for layout references.** Attaching a layout screenshot depends on the agent actually receiving the image; there is at least one open issue where chat-uploaded images did not reach the model. Verify per selected agent.
6. **Auth provider.** Whatever is fastest to stand up standalone. Not consequential at this scale.
7. **Cost governance.** BYOK across multiple models and users. No dashboard in v1, but decide whether per-brand cost attribution is needed before client work runs through it.

---

## 11. Phasing

**Phase 0 — validate before building.** Stand up open-design locally or on a VPS. Write one real `DESIGN.md` and `VOICE.md`. Generate 5–10 real carousels and one deck against real briefs. Answer open questions 1–3. **If output quality is not there, none of the rest matters** — this is the cheapest possible off-ramp and it costs a day.

**Phase 1 — core loop.** Auth, brands, `DESIGN.md`/`VOICE.md`, brief → copy → design → export, job queue, single brand end to end.

**Phase 2 — brand governance.** Reference library with tagging and PPTX extraction, asset library with self-hosted fonts, model selection, skills upload.

**Phase 3 — quality and workflow.** Verification loop as a dev command, automated checks, fixture matrix per template, approval states, variants and version lineage.

**Later, not now.** Design-system wizard, per-brand permission UI, publish/scheduling integration, cost dashboard, a second `Organization` (first client workspace) with query-layer isolation enforced — the FK alone is not isolation.

---

## 12. First real work item

Not code: **the three brand contracts.** A mediocre `DESIGN.md` and `VOICE.md` produce mediocre output regardless of engine, model or wrapper. Ladder, Agent Loopr and personal brand each need a genuinely good pair before Phase 0's output test means anything.
