# Content Studio — Frontend Building Prompt

> **How to use this document:** Work through it phase by phase, in order — one phase per day is the target cadence, but **a phase is complete only when its acceptance criteria pass** (tests green + commit made), never merely because the day ended. Do not skip ahead: the phases are sequenced to match the backend build order (auth first, then data reads, then the pipeline, then governance, then admin), so frontend and backend land hand in hand. The authoritative sources are `../Content_Studio_PRD.md` (the spec) and `./PLAN.md` (which contains the full reference code for every task — consult it for complete file listings). Where this document differs from PLAN.md's reference code, the difference is marked **[AMENDMENT]** and wins — each amendment fixes a verified defect in the reference code (auth on the SSE stream, reload recovery, a double body-read bug, role-correct E2E, and similar).

**Standing decisions (read before Phase 1):**

1. **Product name.** "Content Studio" is a working title only (PRD line 3 says pick a real name before build — and avoid "Studio" alone, which collides with Ladder Brief). Whatever is chosen, put it in one constant (`lib/appName.ts` or `NEXT_PUBLIC_APP_NAME`) and use that everywhere a wordmark or title appears — never hardcode the name in components. This document says "Content Studio" as a placeholder for that constant.
2. **Prerequisite gate (not frontend work).** PRD Phase 0 — open-design stood up, one real DESIGN.md/VOICE.md written, open questions 1–3 answered — should be resolved before or alongside this build. The frontend does not block on it, but the product is not shippable until that gate passes.
3. **Theme provenance.** The "Ladder dark" spec in §3 is an **approved design decision layered on top of the PRD and PLAN.md** — neither source defines a theme. It was derived from live screenshots of ladderflow.ai and ladderbrief.com (saved in `design-refs/`). It changes class values only — never structure, props, or tests.
4. **Data-fetching architecture.** PLAN.md's prose says "server components for reads," but its reference code fetches everything client-side with TanStack Query. **Resolve in favor of the reference code:** server components handle only the auth guard and layout; all data reads and mutations are client components using TanStack Query + `apiFetch`. One data path, one cache, and every PLAN.md test stays valid.
5. **User management.** PRD §3 says the admin manages users; PLAN.md deliberately ships no user screen (Supabase upserts members on first sign-in; admin promotion is a database update). That omission stands for v1 — record it as a known gap; do not quietly build a users page.

---

## 📊 PROGRESS TRACKER

> **RULE: Update this block at the end of every completed phase.** Tick the checkbox, bump the percentage, and update the bar. Never mark a phase complete until its tests pass and its commit is made. The percentages track *phase count*, not effort — phases differ in size; the gate is always the phase's acceptance criteria, never the calendar.

**Overall completion: 20%**

```
[████░░░░░░░░░░░░░░░░]  2 / 10 phases
```

| Phase | Deliverable | Weight | Status |
|---|---|---|---|
| ☑ Phase 1 | Repo + tooling setup, project skeleton, Supabase auth, protected shell | 10% | Complete (2026-08-26) |
| ☑ Phase 2 | Theme system + typed API client + TanStack Query | 10% | Complete (2026-08-26) |
| ☐ Phase 3 | App shell, UI primitives, brand list & switcher | 10% | Not started |
| ☐ Phase 4 | DESIGN.md and VOICE.md contract editors | 10% | Not started |
| ☐ Phase 5 | Briefs — list, manual creation, research pre-fill | 10% | Not started |
| ☐ Phase 6 | Copy stage (write / generate / approve gate) | 10% | Not started |
| ☐ Phase 7 | Generate form, variants, SSE live job progress | 10% | Not started |
| ☐ Phase 8 | Artifact viewer — QA, iterate, approve, export | 10% | Not started |
| ☐ Phase 9 | Reference library + Asset library | 10% | Not started |
| ☐ Phase 10 | Admin (models, skills) + E2E walkthrough + polish | 10% | Not started |

**Bar template per milestone:** 10% = `[██░░░░░░░░░░░░░░░░░░]`, 20% = `[████░░░░░░░░░░░░░░░░]`, 30% = `[██████░░░░░░░░░░░░░░]` … 100% = `[████████████████████]`.

---

## 1. What you are building

Content Studio is a standalone web app for producing **on-brand generative visual content** — social posts, carousels, decks, single-pagers, and images — across multiple brand accounts from one login (PRD §1). The frontend is a **Next.js product layer** over a FastAPI backend, which itself wraps a self-hosted open-design instance. The frontend owns:

- Auth (Supabase, magic-link) and a protected app shell
- Brand management and the four brand contracts: `DESIGN.md`, `VOICE.md`, references, assets
- The content pipeline UI: **Brief → Copy → Design → QA gate → Approval → Export** (PRD §5)
- Live, reconnectable generation progress (SSE), variants, version lineage
- Admin pages for model providers and skills

**Tech stack (fixed — do not substitute):** Next.js 15 (App Router), React 19, TypeScript 5 (strict), Tailwind CSS 4, `@supabase/ssr` + `@supabase/supabase-js`, TanStack Query 5, `zod`, Vitest + Testing Library, Playwright.

## 2. Non-negotiable global constraints

These come from PLAN.md "Global Constraints" and the PRD. Violating any of these is a defect:

1. **App Router only.** No `pages/` directory.
2. **TypeScript strict mode. No `any` in committed code.**
3. **The frontend never decides what is legal.** Status transitions, allowed export formats, and QA pass/fail verdicts are read from the API and rendered. No client-side copy of `TRANSITIONS`, `ALLOWED_FORMATS`, or QA logic. Backend error `detail` strings are shown **verbatim** — never rewritten.
4. **Supabase is auth only.** No `supabase.from(...)` data queries — all data goes through the FastAPI backend with the Supabase access token as a bearer.
5. **The access token never touches `localStorage`** by our code; `@supabase/ssr` cookie storage is the only session store.
6. **Role gating, precisely (PRD §3).** *Members* create briefs, write/generate copy, generate artifacts, iterate, submit for review, and export — those mutations are open to every signed-in user. *Admin-only* mutations are governance, configuration, and approval: brand creation, DESIGN.md/VOICE.md saves, reference/asset upload and delete, model providers, skills, copy approval, and artifact approve/reject. Every admin-only action is gated in the UI **and** the backend — UI gating is affordance, not security. (PLAN.md's shorthand "every mutating action is admin-gated" means exactly this set, as its own reference code shows.)
7. **Generation progress** is followed over SSE at `GET /api/v1/artifacts/{id}/job/stream` and must recover correctly when a page is reopened mid-generation (PRD §7.1 — "survives a closed laptop"). **[AMENDMENT]** The stream must be authenticated — a bare `EventSource` cannot send a bearer header; see Phase 7 for the required proxy / fetch-stream approach.
8. **Artifact types are exactly:** `social_post | carousel | deck | single_pager | image`. No document/contract/proposal type is ever added (PRD §2 — structured documents belong to CIOS, not here).
9. **No publishing or scheduling UI.** Output is exported; posting is manual (PRD §2).
10. **No design-system wizard, no org-switching UI, no per-brand permission UI** (PRD §2 non-goals).
11. **`image` is never offered as a skill scope** — image-mode has no coding agent in the loop (PRD §6.4).
12. **Every task ends with a commit.** TDD throughout: write the failing test first, watch it fail, implement, watch it pass.

## 3. Theme specification — "Ladder dark" (verified against live screenshots of both reference sites)

The UI must follow the shared design language of **ladderflow.ai** and **ladderbrief.com** — a warm, near-black, editorial B2B aesthetic with a coral-red accent. **Actual screenshots of both sites are saved in `frontend/design-refs/` (`ladderflow-hero.png`, `ladderbrief-hero.png`, plus full-page captures) — open and study them before styling anything.** Codify the theme once as Tailwind design tokens in Phase 2 and use only those tokens afterwards — never ad-hoc hex values in components.

**Palette (CSS variables → Tailwind tokens):** *(warm-tinted darks, not cool grays)*

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0E0B09` (near-black, warm brown tint) | Page background |
| `--bg-elevated` | `#171310` | Cards, panels, headers, app chrome |
| `--bg-inset` | `#201A16` | Inputs, editor surfaces, hover fills |
| `--border` | `#2E2623` (warm dark umber) | 1px borders, dividers |
| `--text` | `#F2EDE4` (warm cream, not pure white) | Primary text, headlines |
| `--text-muted` | `#A89F97` (warm gray) | Secondary text, hints, labels |
| `--accent` | `#E8543A` (coral / vermilion) | Primary CTAs, active nav, highlights, dot indicators, focus rings, progress bars |
| `--accent-hover` | `#F0644A` | CTA hover |
| `--accent-fg` | `#FFFFFF` | Text on coral buttons |
| `--success` | `#4ADE80` | Live/approved/passed states (both sites use green only for "live"/positive) |
| `--warning` | `#FBBF24` | QA-failed / draft / attention states |
| `--danger` | `#F87171` | Failed states, destructive actions, error banners |

Optional atmosphere (landing-page flavor, use sparingly in the app): faint warm radial glows behind hero areas and a very subtle dot-grid texture on `--bg`, as both sites do.

**Typography — three faces, as on both sites:**
1. **Display serif** for page-level headlines: a high-contrast editorial serif (use `Instrument Serif` or `Playfair Display` via `next/font`), in `--text` cream, with the occasional key word in *italic* `--accent` coral — this is the signature move on both sites ("Your week is *handled*.", "Videos that *ladder* up."). Use it for page titles (h1) only.
2. **Clean sans** for everything else: `Inter` via `next/font`. Body `text-sm`, hints `text-xs`.
3. **Monospace for micro-labels and data:** uppercase, letter-spaced (`tracking-widest uppercase text-[11px]`) mono (use `JetBrains Mono` or `IBM Plex Mono`) for section tags, stat labels, statuses, versions, token/cost readouts — exactly like `LIVE TRANSCRIPT`, `FOUNDERS IN PILOT`, `$0.47 · 8,412 tok` on the reference sites. Also the face for the DESIGN.md/VOICE.md editors and extracted layout specs.

**Shape & spacing:** generous whitespace, modular sections. **Buttons and badges are pill-shaped (`rounded-full`)** — both sites use fully rounded CTAs. Cards/panels are `rounded-xl` with 1px `--border`; inputs `rounded-lg`. Shadows are minimal; primary CTAs may carry a soft coral glow (`shadow-[0_0_24px_rgba(232,84,58,0.25)]`). Pipeline steps may use the mono numbered-label flavor (`01 BRIEF → 02 COPY → 03 DESIGN…`) in muted mono caps.

**Components:**
- **Primary button:** coral `--accent` fill, white text, `rounded-full`, `hover:bg-[--accent-hover]`, soft coral glow, `disabled:opacity-50`. Arrow suffix (`→` / `↗`) on primary CTAs is on-brand.
- **Ghost button:** transparent or `--bg-elevated`, 1px `--border`, `rounded-full`, cream text, `hover:bg-[--bg-inset]`.
- **Danger button:** `--danger` fill, near-black text, `rounded-full`.
- **Cards/panels:** `--bg-elevated`, 1px `--border`, `rounded-xl`, `p-4`.
- **Status badges:** pill (`rounded-full px-2.5 py-0.5 text-xs`) with a **leading colored dot** (`•`) — the dot-indicator pill is the signature status pattern on both sites (e.g. `• AI Speaking` in green, `• STREAMING` in coral). Map: generating = coral dot, approved/ready = green, qa_failed/draft/in_review = amber, failed = red, queued = muted. Fill is a translucent tint of the semantic color (~12–15% opacity) with the semantic color as text.
- **Inputs/selects/textareas:** `--bg-inset` fill, 1px `--border`, `rounded-lg`, focus ring in `--accent`.
- **Top nav:** the app header may follow Ladder Brief's floating pill nav (a rounded-full elevated bar containing wordmark, links, and the coral CTA) or LadderFlow's flat dark bar — either way: wordmark left, links center/right, coral pill action right.
- **Focus visibility everywhere:** `focus-visible:ring-2 ring-[--accent]` — this is a keyboard-heavy internal tool.

The reference code in PLAN.md is written with light-theme utility classes (`bg-neutral-100`, `text-neutral-500`, etc.). **Keep its structure, props, tests, and behavior exactly, but translate all styling to these dark tokens.** Where a PLAN.md test asserts text or roles, nothing changes; the theme only replaces class values.

## 4. Backend alignment (build order matters)

Per PLAN.md's Execution Handoff: **Phase 1 here can start as soon as backend auth (backend Task 3) exists; Phases 6 onward need backend Phase 1 complete.** Every endpoint you call is defined in `../backend/PLAN.md`. If an endpoint is not live yet, build against the typed contract in `lib/types.ts` with the mock helpers (`tests/helpers.tsx`) — the types mirror the backend Pydantic schemas field for field, so nothing needs rework when the real API lands. Environment contract:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

# THE PHASES

---

## Phase 1 (Day 1) — Repo + tooling setup, project skeleton, Supabase auth, protected shell

**Source:** PLAN.md Task 1 + **[AMENDMENT: repo/tooling setup]**. **Goal:** a git repo with a working test harness, plus a Next.js app where an anonymous visitor is redirected to `/login`, magic-link sign-in works, and everything under `(app)/` is auth-guarded.

**Steps:**
1. **[AMENDMENT] Repo and safe scaffolding first.** The workspace is **not yet a git repository**, and `frontend/` already contains `PLAN.md`, this document, and `design-refs/` — a bare `create-next-app frontend` would refuse the non-empty directory or endanger those files. Do: `git init` at the repo root and commit the existing documents; scaffold into a temporary directory (`npx create-next-app@15 cs-tmp --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*"`); move the generated files into `frontend/` without touching the existing documents; delete the temp dir. **Pin majors in `package.json`** — `next@15`, `react@19`, `tailwindcss@4`, `@tanstack/react-query@5`, `typescript@5` — never float on `@latest` (the stack in §1 is fixed).
2. Install runtime deps `@supabase/supabase-js @supabase/ssr @tanstack/react-query zod` and dev-deps `vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @playwright/test`.
3. **[AMENDMENT] Test harness now, not in Phase 10.** Create:
   - `vitest.config.ts` — jsdom environment, `@/*` path alias, `setupFiles: ['tests/setup.ts']`, and `exclude: ['tests/e2e/**', 'node_modules/**']` so Vitest never collects Playwright specs;
   - `tests/setup.ts` — `import '@testing-library/jest-dom/vitest'`;
   - `playwright.config.ts` — `testDir: './tests/e2e'`, baseURL `http://localhost:3000`, `webServer: npm run dev`. Playwright specs live **only** under `tests/e2e/`; Vitest tests live in `tests/` outside `e2e/` — the two runners never see each other's files. (PLAN.md creates the Playwright config in Task 12 and puts `auth.spec.ts` in `tests/` — both corrected here so Phase 1's own tests can actually run.)
4. Write the failing Playwright test `tests/e2e/auth.spec.ts` (anonymous `/brands` → redirected to `/login`; login page shows Email field + "Send sign-in link" button). Run it, watch it fail.
5. Build the three Supabase helpers exactly as in PLAN.md Task 1: `lib/supabase/client.ts` (`createBrowserSupabase`), `lib/supabase/server.ts` (`createServerSupabase` with cookie `getAll`/`setAll`), `lib/supabase/middleware.ts` (`updateSession` which refreshes the token so a returning tab does not 401 mid-generation), plus root `middleware.ts` with the static-asset matcher.
6. Build `app/login/page.tsx` (client component, `signInWithOtp` with `emailRedirectTo: /auth/callback`, error shown via `role="alert"`) and `app/auth/callback/route.ts` (`exchangeCodeForSession`, redirect to `/brands`).
7. Build `app/(app)/layout.tsx` — server component: `getUser()`, redirect to `/login` if absent, wrap children in `<AppShell email>`. `app/page.tsx` redirects to `/brands`. **[AMENDMENT] Add sign-out:** the shell header carries a "Sign out" control (`supabase.auth.signOut()` then redirect to `/login`) — PLAN.md omits it; an internal tool still needs it.
8. Apply the theme's page-level styling now: warm near-black `--bg` body; load all three `next/font` faces in `app/layout.tsx` (Instrument Serif or Playfair Display for display, Inter for body, JetBrains Mono for micro-labels); login card on `--bg-elevated` with a serif app-name headline (from the name constant) and a coral pill "Send sign-in link" button.
9. Run `npx playwright test tests/e2e/auth.spec.ts` → 2 passed.
10. Commit: `feat: next.js skeleton with supabase auth and a protected shell`.

**Acceptance:** the repo is under git; `npx vitest run` and `npx playwright test` both run cleanly and collect only their own tests; anonymous visits bounce to login; the session lives only in cookies; the app renders dark-themed.

**→ Update the tracker: Phase 1 ☑, overall 10%, bar `[██░░░░░░░░░░░░░░░░░░]`.**

---

## Phase 2 (Day 2) — Theme system, typed API client, TanStack Query

**Source:** PLAN.md Task 2 + theme spec (§3 above). **Goal:** every API type the app will ever use, one fetch wrapper, the query provider, and the design tokens every later phase consumes.

**Steps:**
1. **Theme first.** Define the §3 palette as CSS variables in `app/globals.css` and map them to Tailwind theme tokens (Tailwind 4 `@theme`). Commit to dark as the single deliberate look — set explicit `background` and `color` on `body`.
2. Write the failing Vitest suite `tests/api.test.ts` (5 cases from PLAN.md Task 2: parsed body on success; `ApiError` carrying backend `detail` on 409; non-JSON error body surfaced as text; `undefined` on 204; bearer token attached). Watch it fail.
3. Write `lib/types.ts` **exactly as specified in PLAN.md Task 2 Step 3** — string-literal unions for `Role`, `ArtifactType`, `GenerationMode`, `ArtifactStatus`, `JobState`, `CopyStatus`, `ReferenceScope`, `ReferenceRole`, `AssetType`, `ProviderType`; interfaces `Me`, `Brand`, `Contract`, `Reference`, `Asset`, `Brief`, `Copy`, `QaFinding`, `QaReport`, `Artifact`, `JobSnapshot`, `Provider`, `Skill`. These mirror the backend Pydantic schemas field for field — a typo is a compile error.
4. Write `lib/api.ts`: `ApiError extends Error { status, detail }`; `apiFetch<T>(path, init)` that resolves the Supabase session token in the browser, sets the bearer header, sets `content-type: application/json` only for non-FormData bodies, throws `ApiError` with the backend's `detail` verbatim on non-OK, returns `undefined` for 204. **[AMENDMENT — fixes a real bug in PLAN.md's reference `apiFetch`]:** on a non-OK response, read the body **once** with `await response.text()`, then `try { JSON.parse(...) }` to extract `detail`, falling back to the raw text. PLAN.md's version calls `response.json()` and then `response.text()` in the catch — the body is already consumed by then, so the fallback throws and its own non-JSON test would fail.
5. Write `app/providers.tsx` (`QueryClientProvider`, `staleTime: 30_000`, `retry: 1`) and wrap `{children}` in `app/layout.tsx`.
6. Run `npx vitest run tests/api.test.ts` → 5 passed.
7. Commit: `feat: typed api client mirroring the backend schemas` (+ theme tokens).

**Acceptance:** `apiFetch` is the only way the app talks to the network; all enums exist once; the token pipeline works; design tokens are in place.

**→ Update the tracker: Phase 2 ☑, overall 20%, bar `[████░░░░░░░░░░░░░░░░]`.**

---

## Phase 3 (Day 3) — App shell, UI primitives, brand list & switcher

**Source:** PLAN.md Task 3. **Goal:** the persistent shell (header, admin links, brand switcher), the six presentational primitives every later phase reuses, and the brand pages.

**Steps:**
1. Write the failing test `tests/brands.test.tsx` (BrandSwitcher lists every brand and marks current as selected; StatusBadge renders `qa_failed` → "QA failed" and `in_review` → "In review"; EmptyState shows title + action). Also create `tests/helpers.tsx` (`renderWithQuery`, `mockApi`) from PLAN.md Task 4 Step 1 — you need it from here on.
2. Build `components/ui/`: `StatusBadge` (label map + tone map per status — §3 badge styling: dot-indicator pills with translucent semantic tints), `ErrorBanner` (`role="alert"`, shows `ApiError.detail` verbatim, `--danger` tinting), `EmptyState` (dashed `--border` card), `Button` (`primary` = coral pill / `ghost` = bordered pill / `danger`), `Field` (label + hint wrapper, mono uppercase label styling), `Spinner` (`role="status"`).
3. Build `components/shell/`: `BrandSwitcher` (a `<select aria-label="Brand">` that routes to `/brands/{id}`), `NavLinks` (sidebar sections: Overview, DESIGN.md, VOICE.md, References, Assets, Briefs — active link in accent style with `aria-current="page"`; an Artifacts section is added in Phase 8), `AppShell` (top header: the app wordmark from the name constant, the signed-in email, the Sign out control from Phase 1; `--bg-elevated` header over `--bg` main, `max-w-6xl` content column). **[AMENDMENT — wire what PLAN.md creates but never renders]:** the header must actually mount `<BrandSwitcher>` (a small client wrapper queries `/brands` and derives the current id from the route), and the `/admin/models` + `/admin/skills` links render **only when `/me` reports `role === 'admin'`** — members must not see admin navigation. (Backend admin routes stay guarded regardless — the nav is affordance.)
4. Build `app/(app)/brands/page.tsx`: query `/me` and `/brands`; empty state with role-aware hint; brand list; **admin-only** create form (`POST /brands`, invalidate on success).
5. Build `app/(app)/brands/[brandId]/page.tsx` (brand overview): query brand, `/brands/{id}/design`, `/brands/{id}/voice`. **PRD §12 rule:** if either contract has `version === 0`, show the amber "This brand is not ready to generate" banner with links to write DESIGN.md / VOICE.md. Link to "Start a brief".
6. Run `npx vitest run tests/brands.test.tsx` → 5 passed.
7. Commit: `feat: app shell, ui primitives and brand pages`.

**Acceptance:** an admin can create a brand and navigate; a member sees the same minus create; unready brands say so plainly.

**→ Update the tracker: Phase 3 ☑, overall 30%, bar `[██████░░░░░░░░░░░░░░]`.**

---

## Phase 4 (Day 4) — DESIGN.md and VOICE.md contract editors

**Source:** PLAN.md Task 4; PRD §4.1–4.2. **Goal:** plain-markdown editors for the two brand contracts — admins paste content directly (no wizard, PRD §2), members read only.

**Steps:**
1. Write the failing test `tests/contract-editor.test.tsx` (5 cases: loads content into the textarea; shows "version 3"; save disabled until content changes; member sees a disabled textarea and **no** save button; a 403 `admin only` from the backend appears verbatim in `role="alert"`).
2. Build `components/brand/ContractEditor.tsx` (`brandId`, `kind: 'design' | 'voice'`, `readOnly`): loads `GET /brands/{id}/{kind}`; monospace textarea (28 rows, `--bg-inset`, `spellCheck={false}`); tracks a local draft, `dirty` compare; `PUT` on save, updates the query cache; "version N" / "not written yet" indicator; "Unsaved changes" hint. Per-kind hint copy exactly as in PLAN.md: DESIGN.md — "Palette, type scale, spacing rhythm… Hex values written here are what the QA palette check enforces."; VOICE.md — "What the brand sounds like, what it never says, claim-substantiation rules, banned AI-tell patterns. Copy generation refuses to run without this."
3. Build the two pages `brands/[brandId]/design/page.tsx` and `voice/page.tsx`: fetch `/me`, pass `readOnly={me.role !== 'admin'}`, render inside the `NavLinks` grid.
4. Run `npx vitest run tests/contract-editor.test.tsx` → 5 passed.
5. Commit: `feat: DESIGN.md and VOICE.md editors with admin-only save`.

**Acceptance:** an admin can author both contracts; a member can read them; backend refusals surface verbatim.

**→ Update the tracker: Phase 4 ☑, overall 40%, bar `[████████░░░░░░░░░░░░]`.**

---

## Phase 5 (Day 5) — Briefs: list, manual creation, research pre-fill

**Source:** PLAN.md Task 5; PRD §5.1, §9. **Goal:** brief creation with manual entry as the default and an optional research-agent pull that **pre-fills for editing — never auto-proceeds**.

**Steps:**
1. Write the failing test `tests/brief-new.test.tsx` (5 cases: manual brief textarea by default; a "Pull from research" button exists; a pulled thesis lands **in the editable textarea** with save enabled — the PRD §5.1 review step; a 503 `manual-only` backend fallback shows verbatim and manual entry stays usable; empty brief cannot be saved).
2. Build `brands/[brandId]/briefs/new/page.tsx`: optional "Research question" field + ghost "Pull from research" button (`POST /briefs/from-research`) whose success **only** sets the textarea content and remembers `research_run_id`; the "Brief" textarea (hint: "What this piece is for, who it is for, what it must say."); when pre-filled, the note "Pre-filled from research run {id}. Edit before saving."; "Save brief" (`POST /briefs` with `source: research_run_id ? 'research_agent' : 'manual'`), then route to `/briefs/{id}`. **[AMENDMENT — no duplicate briefs; align the contract with the backend]:** PLAN.md's flow pulls from `/briefs/from-research` and then creates a second row via `POST /briefs`; if the backend persists a brief inside `/from-research` (as the backend plan suggests), every pull produces a duplicate. Resolve one way, with the backend team: **(preferred)** `/briefs/from-research` returns a **non-persisted `ResearchPrefill`** (`content`, `research_run_id`) and the only persisted brief comes from `POST /briefs`; **(fallback)** if the backend must persist on pull, the save button issues `PATCH /briefs/{id}` on that already-created brief instead of a second POST. Either way the invariant is: **one pull → at most one brief row.** Add a test asserting no second create call fires on the pull path you implement.
3. Build `brands/[brandId]/briefs/page.tsx`: brief list with first-90-chars preview, "from research" tag on research-sourced briefs, "New brief" link, empty state.
4. Run `npx vitest run tests/brief-new.test.tsx` → 5 passed.
5. Commit: `feat: manual and research-backed brief creation with a review step`.

**Acceptance:** both paths work; a brand without a research connection degrades gracefully to manual-only (PRD §9 — expected, not a bug).

**→ Update the tracker: Phase 5 ☑, overall 50%, bar `[██████████░░░░░░░░░░]`.**

---

## Phase 6 (Day 6) — The copy stage

**Source:** PLAN.md Task 6; PRD §5.2. **Goal:** copy is written **or** generated, reviewed, and approved before design can begin. Hand-written copy is first-class — the default tab, not a fallback.

**Steps:**
1. Write the failing test `tests/copy-stage.test.tsx` (6 cases: "Write it" and "Generate" render as peer tabs; generate is disabled with no enabled coding-agent provider; a 422 "brand has no VOICE.md" refusal shows verbatim; admin sees "Approve copy" on a draft; member never sees approve; editing approved copy shows the "return to draft" warning).
2. Build `components/copy/CopyStage.tsx` (`brief`, `copy?`, `onApproved`): status badge + version; explainer line "Copy is approved before design begins. The design agent consumes it; it does not write it."; tab list `Write it` (default) / `Generate from VOICE.md`; generate panel with model select filtered to `enabled && type === 'coding_agent'` providers and `POST /briefs/{id}/copy { generate: true, model_provider_id }`; textarea bound to local text; mutations: create (`generate: false, content`), update (`PATCH /copy/{id}`), approve (`POST /copy/{id}/approve`, admin-only, disabled while dirty, fires `onApproved`); amber warning when editing approved copy.
3. Build `app/(app)/briefs/[briefId]/page.tsx`: brief content, `<CopyStage>`, and below it either `<GenerateForm>` (once copy is approved — wired fully in Phase 7; stub the import now) or the locked panel "Design unlocks once the copy is approved." **[AMENDMENT — reload recovery, PRD §7.1]:** PLAN.md keeps the approved copy only in local `approvedCopy` state, so reloading the page re-locks Design and loses the copy entirely. Instead the page **queries the current copy from the server** — `GET /briefs/{id}/copy` (the endpoint PLAN.md's own Task 6 tests already mock) — passes it into `<CopyStage copy={...}>`, and derives the Design unlock from `copy.status === 'approved'` in that query's data; the `onApproved` callback just updates/invalidates the query. Add a reload test: with the API returning an approved copy, a fresh render (simulating a reopened tab) shows Design unlocked and the copy populated.
4. Run `npx vitest run tests/copy-stage.test.tsx` → 6 passed.
5. Commit: `feat: copy stage with hand-written and generated paths, gated on approval`.

**Acceptance:** the approval gate is real and visible; nothing about design renders actionable until copy is `approved`.

**→ Update the tracker: Phase 6 ☑, overall 60%, bar `[████████████░░░░░░░░]`.**

---

## Phase 7 (Day 7) — Generate form, variants, SSE live progress

**Source:** PLAN.md Task 7; PRD §5.3, §7.1. **Goal:** kick off generation (with N variants), and follow it over a reconnectable SSE stream that survives closed laptops, dropped sockets, and reopened tabs.

**Steps:**
1. Write the failing test `tests/job-stream.test.tsx` with the `FakeEventSource` from PLAN.md (7 cases: hook exposes the latest snapshot; closes the stream on a terminal state; **reconnects after an error rather than giving up**; no stream without an artifact id; `JobProgress` recovers the current stage when opened mid-generation via the snapshot query; shows "Attempt 2" when retried; shows the failure reason in `role="alert"`).
2. Build `lib/useJobStream.ts` — same contract as PLAN.md: returns `{ snapshot, connected, error }`, parses each message as `JobSnapshot`, stops on `succeeded`/`failed`, retries 2s after an error, full cleanup on unmount. **[AMENDMENT — the stream must authenticate]:** the backend stream is bearer-protected, and a bare `EventSource` cannot send an `Authorization` header — PLAN.md's `new EventSource(backendUrl)` would simply 401. Implement one of: **(a — preferred)** a same-origin Next.js route handler `app/api/artifacts/[artifactId]/job/stream/route.ts` that reads the Supabase session from cookies, opens the backend stream with the bearer, and pipes the `ReadableStream` back — the hook then connects `EventSource('/api/artifacts/{id}/job/stream')` same-origin; or **(b)** replace `EventSource` inside the hook with an authenticated `fetch()` + incremental SSE parser. Keep the PLAN.md tests by faking whichever primitive you use, and add tests for: **auth failure** (401 → surfaced error, no infinite retry loop), **a malformed event** (ignored, stream continues), and **reconnect-timer cleanup on unmount**.
3. Build `components/generate/JobProgress.tsx`: initial `GET /artifacts/{id}/job` snapshot query (this is what makes a reopened page correct immediately), then the live stream takes over (`live ?? initial.data`); stage label map (queued → "Waiting for a free generation slot", syncing_brand → "Syncing brand system, assets and fonts", generating, qa → "Running quality checks", done); accent-colored progress bar with `role="progressbar"` and aria values; attempts count; failure banner.
4. Build `components/generate/GenerateForm.tsx`: artifact-type select over exactly the five types with their modes (social_post/carousel/deck/single_pager = code, image = image); model select filtered by the matching provider type (`coding_agent` vs `image_provider`) and `enabled`; **Variants** number input 1–8 with hint "One brief, N options." (PRD §5.3 — variants are the real workflow); `POST /artifacts` returns an array; render a `JobProgress` + "Open artifact" link per created artifact; helper text when no matching provider is enabled. **[AMENDMENT — created artifacts must survive a reload]:** PLAN.md holds the created artifacts only in component state, so a reload loses every "Open artifact" link while the jobs still run. Fix: for a single artifact, `router.push('/artifacts/{id}')` immediately after creation (the artifact page owns the progress from there); for N variants, keep the inline progress list but treat the brand **Artifacts list (Phase 8)** as the durable discovery path — the artifacts and their jobs live server-side, so nothing is lost when the tab closes.
5. Run `npx vitest run tests/job-stream.test.tsx` → 7 passed.
6. Commit: `feat: generate form with variants and reconnectable live progress`.

**Acceptance:** reloading mid-generation shows the correct current stage instantly, then continues live.

**→ Update the tracker: Phase 7 ☑, overall 70%, bar `[██████████████░░░░░░]`.**

---

## Phase 8 (Day 8) — Artifact viewer: QA report, iteration, approval, export

**Source:** PLAN.md Task 8; PRD §5.4–5.7, §6.2. **Goal:** the page where an artifact is inspected, QA findings are read, edits are requested (each one a new version), approval moves through explicit states, and exports are downloaded.

**Steps:**
1. Write the failing test `tests/artifact.test.tsx` (9 cases across three components: QaReportPanel says "passed" when clean, lists every finding with its check name and detail, shows "page 3" placement, names skipped checks; ExportPanel offers export links from the API's signed URLs, explains that a **final** export needs approval, offers the all-cards ZIP only for a carousel; IterateBox sends the instruction and reports "version 2", refuses an empty instruction).
2. Build `components/artifact/QaReport.tsx`: check-label map (structure, overflow, bounds, tokens → "Unbroken prices, dates and identifiers", fill → "Dead space", palette, fonts → "Brand fonts actually rendered", determinism → "Two identical builds match"); "Quality checks have not run yet." for an empty report; findings as left-bordered rows (`--danger` for errors, `--warning` for warnings) with verbatim detail; skipped-checks footnote; "Re-run checks" ghost button; guidance line when status is `qa_failed`.
3. Build `components/artifact/IterateBox.tsx` (`POST /artifacts/{id}/iterate { instruction }` → new child artifact; hint "Every edit creates a new version. Nothing is overwritten."; renders the child's `JobProgress` and link), `ExportPanel.tsx` (exports query enabled only for `ready|in_review|approved`; "working exports" caveat until approved — **[AMENDMENT]** every download link, the carousel ZIP included, comes **only** from the API's exports response as a signed/authenticated URL: PLAN.md hand-builds `{BASE}/artifacts/{id}/exports/png.zip`, which is both unauthenticated and a client-side copy of the format rules; instead the backend includes a `zip` entry for carousels and the panel simply renders whatever formats come back), `VersionTimeline.tsx` (`GET /artifacts/{id}/lineage`, renders v1→vN with status badges, hidden under 2 versions), `VariantGrid.tsx` (`GET /artifacts/{id}/variants`, "Options from this brief" grid, current option ring-highlighted, hidden under 2 variants), and `ArtifactViewer.tsx` — **[AMENDMENT — human QA needs pages]:** PLAN.md renders one PNG, but the PRD's QA gate (§6.1) is a review of **rasterised pages**; a carousel or deck cannot be honestly approved from a single image. The viewer must render every page/card the API exposes (a `pages` array or per-page entries in `export_urls` — coordinate the field with the backend): thumbnail strip + main view, prev/next navigation and a page counter, click-to-zoom/full-size inspection, and **QA correlation** — selecting a finding that carries a `page` number switches the viewer to that page. Single-image artifacts degrade to the simple view; no pages yet renders the dashed "No preview yet."
4. Build `app/(app)/artifacts/[artifactId]/page.tsx`: two-column layout (viewer + variants left; QA, approval, export, iterate, versions right); artifact query with `refetchInterval` 3s while `queued|generating`; `JobProgress` while generating; **approval section renders only the actions the current status allows**: `ready` → "Submit for review"; `in_review` + admin → "Approve" / "Send back"; `in_review` + member → "Waiting on an admin."; `approved` → "Approved. Iterating creates a new version."; `qa_failed` → "Quality checks must pass before this can go to review." All transitions are `POST`s; the backend is the referee. **[Clarification of constraint 3]:** this status→button map is a display affordance, not a legality decision — an out-of-date map can only show a button the backend then refuses, and that refusal's `detail` is shown verbatim. If the backend adds an `allowed_actions` array to the artifact response (recommended — request it), render the buttons from it and delete the local map.
5. **[AMENDMENT — durable artifact discovery]** Build `app/(app)/brands/[brandId]/artifacts/page.tsx`: the brand's artifacts from `GET /artifacts?brand_id={id}`, newest first — type, version, status badge, created time — each row linking to its artifact page; add an **Artifacts** item to `NavLinks`. This is what makes generation survive a closed laptop end-to-end: come back, open Artifacts, find the `generating` row, watch it live. Add a test: a `queued` artifact appears in the list and links to a page showing `JobProgress`.
6. Run `npx vitest run tests/artifact.test.tsx` → 9 passed, plus the new multi-page viewer and artifacts-list tests.
7. Commit: `feat: artifact viewer with qa report, iteration, approval and export`.

**Acceptance:** the full pipeline tail (QA → approval → export) is visible and state-correct for both roles. **Phase 1 of the PRD's core loop is now fully covered.**

**→ Update the tracker: Phase 8 ☑, overall 80%, bar `[████████████████░░░░]`.**

---

## Phase 9 (Day 9) — Reference library + Asset library

**Source:** PLAN.md Tasks 9 & 10; PRD §4.3–4.4. **Goal:** the brand-governance uploads — tagged visual references (with PPTX parsing made visible) and real assets with fonts treated as P0.

**Steps — references (PLAN.md Task 9):**
1. Failing test `tests/references.test.tsx` (7 cases: uploader requires scope and role selects; explains "Tag it, don't describe it"; a 422 `unreadable pptx` rejection shows verbatim; grid shows scope + role tags on each card; a parsed PPTX shows "Layout spec extracted"; the grid states "consistent brand feel, not pixel-exact" — PRD §4.3 expectation-setting; member sees no Remove button).
2. `components/brand/ReferenceUploader.tsx`: file input (`image/*,.pptx`), scope select (`social|presentation|both` — hint "Which generations may see it."), role select (`layout|typography|colour_gradient|overall_vibe` — hint "What to take from it."), FormData `POST /brands/{id}/references`, invalidate on success.
3. `components/brand/ReferenceGrid.tsx`: image thumbnails or a PPTX placeholder tile; scope pill (solid) + role pill (muted); green "Layout spec extracted" when `extracted_layout_spec` is set; admin-only Remove (`DELETE /references/{id}`); the expectation-setting line above the grid.
4. `brands/[brandId]/references/page.tsx`: uploader admin-only; grid `readOnly={!isAdmin}`. Tests pass — **7 cases** (PLAN.md's "Expected: 8 passed" miscounts its own list of 3 uploader + 4 grid cases), commit: `feat: reference library with scope and role tagging`.

**Steps — assets (PLAN.md Task 10):**
5. Failing test `tests/assets.test.tsx` (5 cases: uploader offers every asset type including `font`; a 422 font-extension rejection (`.otf/.ttf/.woff/.woff2`) shows verbatim; grid groups Fonts separately from Logos and images; **warns "No brand fonts uploaded"** when the brand has none — PRD §4.4: typography silently falls back without self-hosted fonts; no warning once a font exists).
6. `components/brand/AssetUploader.tsx`: file + type select (`logo|font|headshot|screenshot|icon`) + label; explainer: "Generated artifacts inject these real files. An AI-approximated logo is never acceptable output, and font files must live here or typography falls back silently."
7. `components/brand/AssetGrid.tsx`: **Fonts section first** with the amber no-fonts warning ("…the font QA check will fail.") or font chips with admin-only remove; then the logos/images grid with thumbnails, labels, types, admin-only remove.
8. `brands/[brandId]/assets/page.tsx` wiring as before. Tests pass (5), commit: `feat: asset library with a visible warning when fonts are missing`.

**Acceptance:** both governance libraries work end to end; PPTX parsing status and the fonts-P0 rule are visible in the UI, not just in the backend.

**→ Update the tracker: Phase 9 ☑, overall 90%, bar `[██████████████████░░]`.**

---

## Phase 10 (Day 10) — Admin pages, end-to-end walkthrough, final polish

**Source:** PLAN.md Tasks 11 & 12; PRD §6.4, §10.7. **Goal:** the admin surface for models and skills, the full-loop E2E proof, and the final sweep.

**Steps — admin (PLAN.md Task 11):**
1. Failing test `tests/admin.test.tsx` (6 cases: the models page **never renders an API key back to the screen**; admin can disable a provider; a member is told "Models are admin only."; the skills page **does not offer `image` as a scope** and explains why ("Images have no coding agent in the loop…"); an uploaded skill lists its scopes).
2. `admin/models/page.tsx`: admin-gated; add-provider form — kind (`coding_agent|image_provider`), name (hint: "As open-design expects it, e.g. claude, kimi, gpt-image-2."), API key as `type="password"` with hint "Encrypted on save. Never shown again."; provider list with Enable/Disable toggles (`PATCH /providers/{id}`).
3. `admin/skills/page.tsx`: admin-gated; SKILL.md upload with name + `applies_to` checkboxes over exactly `['social_post','carousel','deck','single_pager']` — `image` deliberately absent (PRD §6.4; the backend refuses it too — this list is the affordance, not the enforcement); skill list with scopes and Enable/Disable. Tests pass (6), commit: `feat: admin pages for models and skills with image scope withheld`.

**Steps — E2E + polish (PLAN.md Task 12):**
4. The Playwright config already exists from Phase 1. **[AMENDMENT — the E2E must authenticate, and the roles must be honest]:** PLAN.md's spec runs one unauthenticated session that approves copy and artifacts — but approval is admin-only (PRD §3), and the app requires login at all. Add a login fixture: a Playwright global-setup signs in seeded test users via Supabase and saves `storageState` — one **admin** state, and (for the split-role test) one **member** state. Then write `tests/e2e/full-loop.spec.ts`: **(a)** the full loop as the **admin** session — brand → new brief → hand-written copy → save → approve (admin right) → carousel + model → generate → progressbar visible → **reload mid-generation and recover via the Artifacts list** → quality checks visible → submit for review → approve → export link visible; **(b)** design stays locked while copy is a draft ("Design unlocks once the copy is approved." visible); **(c — the honest role split, strongly recommended)** member session creates the brief/copy and submits, admin session approves the copy and the artifact, member session downloads the export.
5. Run against the real stack (`docker compose up` in backend, then `npx playwright test`). If it hangs at "Quality checks", the QA gate or open-design is the problem — check worker logs, not the frontend.
6. Full suite: `npx vitest run && npx playwright test` → all green.
7. **Final polish pass:** verify every screen against the §3 theme tokens (no stray light-theme classes), keyboard focus rings everywhere, `aria` roles intact, empty/loading/error states on every route, and the PLAN.md Self-Review table (every PRD section maps to a shipped screen).
8. Commit: `test: end-to-end walkthrough from brief to export`.

**Acceptance:** the complete PRD §5 pipeline works in a browser against the real backend; all unit, component, and E2E tests pass.

**→ Update the tracker: Phase 10 ☑, overall 100%, bar `[████████████████████]`. Frontend complete.**

---

## Appendix A — Route ↔ endpoint map (backend alignment)

| Frontend surface | Backend endpoints consumed |
|---|---|
| Auth shell | Supabase (`signInWithOtp`, `exchangeCodeForSession`, `getUser`) |
| Brands | `GET/POST /brands`, `GET /brands/{id}`, `GET /me` |
| Contracts | `GET/PUT /brands/{id}/design`, `GET/PUT /brands/{id}/voice` |
| Briefs | `GET/POST /briefs`, `POST /briefs/from-research` (returns a **non-persisted prefill** — see the Phase 5 amendment), `GET /briefs/{id}` |
| Copy | `GET/POST /briefs/{id}/copy` (the GET powers reload recovery — Phase 6 amendment), `PATCH /copy/{id}`, `POST /copy/{id}/approve` |
| Generate | `GET /providers`, `POST /artifacts` (returns array — variants) |
| Job progress | `GET /artifacts/{id}/job`; SSE `GET /artifacts/{id}/job/stream` reached through the authenticated same-origin proxy route (Phase 7 amendment) |
| Artifact | `GET /artifacts?brand_id={id}` (the Artifacts list — Phase 8 amendment), `GET /artifacts/{id}`, `POST /artifacts/{id}/{qa\|submit\|approve\|reject\|iterate}`, `GET /artifacts/{id}/{lineage\|variants\|exports}` (exports returns signed URLs for **every** format, the carousel ZIP included) |
| References | `GET/POST /brands/{id}/references`, `DELETE /references/{id}` |
| Assets | `GET/POST /brands/{id}/assets`, `DELETE /assets/{id}` |
| Admin | `GET/POST /providers`, `PATCH /providers/{id}`, `GET/POST /skills`, `PATCH /skills/{id}` |

## Appendix B — Things this frontend must NEVER contain

Copied from the PRD's non-goals so no phase drifts:
- Contracts, proposals, SOWs, reports, or any structured-document type (→ CIOS)
- Publishing or scheduling of any kind
- A design-system wizard / guided brand setup
- Org creation or switching UI; invite flows; external/client logins
- Per-brand permission UI (`BrandAccess` is schema-only in v1)
- `image` as a skill scope
- A canvas or drag-editing surface (iteration is conversational, by design)
- Client-side re-implementation of any backend rule (transitions, formats, QA verdicts)

## Appendix C — Backend coordination checklist (from the amendments)

Raise these with the backend owner **before** the phase that needs them; each is small but contract-level:

1. **Phase 5:** `/briefs/from-research` should return a non-persisted `ResearchPrefill` (else expose `PATCH /briefs/{id}`) — one pull must never yield two brief rows.
2. **Phase 6:** `GET /briefs/{id}/copy` returns the brief's current copy (PLAN.md's tests already assume it) — powers reload recovery of the approval gate.
3. **Phase 7:** the SSE stream is consumed through a same-origin Next.js proxy that injects the bearer — backend needs no change, but confirm the stream tolerates proxied connections and reconnects.
4. **Phase 8:** `GET /artifacts?brand_id={id}` list endpoint; per-page raster URLs for carousels/decks (a `pages` array or per-page `export_urls` entries); the exports response includes the carousel `zip` as a signed URL; optionally an `allowed_actions` array on the artifact so the UI can drop its status→button map.
5. **Phase 10:** two seeded test users (one admin, one member) for the Playwright login fixture.
