# Content Studio - frontend

Next.js 15 (App Router) product layer over the FastAPI backend. See `FRONTEND_BUILD_PROMPT.md` for the phased build (and its progress tracker) and `PLAN.md` for reference code.

```bash
cp .env.example .env.local   # fill in Supabase values
npm install
npm run dev                  # http://localhost:3000
npm run typecheck && npm run lint
npm test                     # Vitest (tests/**, excluding tests/e2e)
npm run test:e2e             # Playwright (tests/e2e only; starts the dev server)
npm run build                # production build
```

## Browsing without Supabase or the backend (dev only)

Two flags in `.env.local`, both ignored by production builds and marked by an amber banner:

- `NEXT_PUBLIC_AUTH_BYPASS=true` keeps the login page but signs in **without Supabase**: submitting the form sets a plain `cs-dev-session` cookie, the guard accepts it, Sign out clears it (no real session, no API token).
- `NEXT_PUBLIC_API_MOCK=true` answers every `apiFetch` call from the in-memory mock backend in `lib/mock/` (fixtures in `data.ts`, routes in `handler.ts`). It supports the whole loop: create brands, save contracts, approve copy, generate artifacts (a fake job runs ~20s with live progress and lands in QA), iterate, submit, approve, export. It returns the real backend's error `detail` strings (no VOICE.md, unapproved copy, wrong font extension, admin-only) so the verbatim-error UI can be seen.
  - **Reload-stable.** State is snapshotted to `sessionStorage` after every request (same tab; a new tab starts from the fixtures). Running jobs resume from their persisted start time, so reload-mid-generation and Artifacts-list recovery can be exercised without a backend. "Reset mock data" in the dev banner (or `resetMockState()` in tests) restores the fixtures.
  - **Runtime role.** The dev banner has an `admin | member` switch (kept in sessionStorage); `/me` follows it immediately and `/admin/*` bounces to `/brands` when you switch to member. `NEXT_PUBLIC_MOCK_ROLE` only sets the default.
  - **Real export files.** Exports resolve to tiny valid fixtures in `public/mock-downloads/` (PNG, JPG, PDF, HTML, ZIP of cards, PPTX), one distinct URL per format per artifact. Which formats an artifact type gets is the mock's rule; the UI renders whatever comes back.
  - **Variants vs iterations.** `/variants` returns the latest version of each option branch; `/lineage` returns v1 -> vN of the selected branch. Iterating an option never adds an option.
  - **SSE scenarios** at `/dev/sse` (linked from the banner) drive the *production* `useJobStream` hook and `JobProgress` against scripted streams served by `app/api/mock/stream/{scenario}`: normal success, dropped connection + reconnect, malformed event, terminal failure with the exact error, fatal 401 with no retry loop. Regular mock pages poll the job snapshot instead of streaming; this page is the only place the stream path runs without a backend.

Remove both flags once Supabase and the FastAPI backend exist; nothing else changes. `DEV_ONLY_CHANGES.md` lists every file touched and how to delete the dev-only code.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase auth (magic link, cookie session). The anon key is public by design; the backend holds the secret keys. |
| `NEXT_PUBLIC_API_URL` | browser | FastAPI base, e.g. `http://localhost:8000/api/v1` |
| `API_URL` | server (optional) | Backend URL for the SSE proxy route if it differs from the public one |
| `NEXT_PUBLIC_APP_NAME` | both | Wordmark / title ("Content Studio" is a working title) |
| `NEXT_PUBLIC_AUTH_BYPASS` | dev only | See above |
| `E2E_ADMIN_EMAIL/PASSWORD`, `E2E_MEMBER_EMAIL/PASSWORD`, `E2E_BRAND` | Playwright | Seeded users (with passwords) for `tests/e2e/full-loop.spec.ts`; the spec skips without them |

## End-to-end walkthrough

`tests/e2e/auth.spec.ts` always runs. `tests/e2e/full-loop.spec.ts` (brief -> copy -> approve -> generate -> reload mid-generation -> QA -> review -> approve -> export, plus the member/admin role split) needs the backend stack (`docker compose up` in `../backend`), a brand with DESIGN.md and VOICE.md written, one enabled coding-agent provider, and the seeded users above. `tests/e2e/global-setup.ts` signs them in with a password and writes Playwright storage states to `tests/e2e/.auth/` (gitignored).

## Known gaps (v1, deliberate)

- **User management UI.** PRD section 3 says the admin manages users; the build prompt records this as a deliberate v1 omission: Supabase upserts members on first sign-in and admin promotion is a database update. No users page exists and none is claimed. It is a known gap, not silently complete.
- **Final product name.** "Content Studio" is the PRD's working title. The name lives in `lib/appName.ts` / `NEXT_PUBLIC_APP_NAME` and is unresolved until the owner supplies the final name.
