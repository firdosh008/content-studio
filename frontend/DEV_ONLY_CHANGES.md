# Dev-only changes (remove before shipping)

Everything here exists so the frontend can be used before Supabase and the FastAPI backend exist. Each item is gated by an env flag **and** `NODE_ENV !== 'production'`, so a production build ignores all of it — but the code should still be deleted once the real stack is live. No PRD behaviour depends on any of this.

## Flags (in `frontend/.env.local`, gitignored)

| Flag | Effect |
|---|---|
| `NEXT_PUBLIC_AUTH_BYPASS=true` | The login page signs in **without Supabase** by setting a plain `cs-dev-session` cookie; the protected layout accepts that cookie instead of a Supabase user; Sign out clears it. The magic-link flow is untouched when the flag is off. |
| `NEXT_PUBLIC_API_MOCK=true` | Every `apiFetch` call is answered by the in-memory mock backend in `lib/mock/` instead of the network. State is snapshotted to `sessionStorage` (`cs-mock-db`) so a reload of the same tab resumes; a new tab starts from the fixtures. No tokens or secrets are stored. |
| `NEXT_PUBLIC_MOCK_ROLE=admin\|member` | Default role for the mock `/me`. The dev banner's `admin \| member` switch overrides it at runtime (sessionStorage `cs-mock-role`). |

An amber banner at the top of the shell shows which of these are on.

## Code touched

| File | Dev-only part | Removal |
|---|---|---|
| `lib/authBypass.ts` | **Entire file** — `AUTH_BYPASS`, `DEV_SESSION_COOKIE`, `setDevSession`, `clearDevSession`, `BYPASS_EMAIL` | Delete the file |
| `app/(app)/layout.tsx` | The `if (AUTH_BYPASS) { … }` block that reads the dev cookie and renders `<AppShell bypass>` | Delete the block and the `cookies` / `authBypass` imports |
| `app/login/page.tsx` | In `signIn`: the `if (AUTH_BYPASS) { setDevSession(email); router.replace('/brands') … }` branch; the button label switch and the "Dev mode: signs in without Supabase" hint | Delete the branch, restore the plain "Send sign-in link" label, drop the `useRouter` and `authBypass` imports |
| `components/shell/SignOutButton.tsx` | The `if (AUTH_BYPASS) clearDevSession()` branch | Delete the branch and the import |
| `components/shell/AppShell.tsx` | The `bypass` prop and the amber banner (with `DevRoleSwitch` and the SSE-scenarios link) | Delete the prop and the banner; `AppShell` goes back to `{ email, children }` |
| `lib/mock/index.ts`, `lib/mock/data.ts`, `lib/mock/handler.ts` | **Entire directory** — flag, runtime role, fixtures, sessionStorage persistence, route handler | Delete `lib/mock/` |
| `components/shell/DevRoleSwitch.tsx` | **Entire file** — the banner's admin/member switch and "Reset mock data" | Delete the file |
| `app/api/mock/stream/[scenario]/route.ts` | **Entire file** — scripted SSE streams for the harness (404 outside dev/mock) | Delete the file |
| `app/(app)/dev/sse/page.tsx` | **Entire file** — the SSE scenario page (`notFound()` outside mock mode) | Delete the file |
| `public/mock-downloads/` | Tiny valid PNG/JPG/PDF/HTML/ZIP/PPTX export fixtures | Delete the directory |
| `lib/useJobStream.ts` | Optional `options.url` override (defaults to the production proxy path; only the dev page passes it) | Harmless to keep; drop the option with the harness |
| `lib/api.ts` | `mockRequest()` and the `API_MOCK ? mockRequest(...) : fetch(...)` switch | Restore `const response = await fetch(...)`; drop the `@/lib/mock` import |
| `components/generate/JobProgress.tsx` | `streamUrl` prop, `refetchInterval` polling when the mock is on without a stream, and the `useStream` guard on `useJobStream` | Drop the prop and `useStream`; restore `refetchInterval` to none and pass `initialTerminal ? undefined : artifactId`; drop the import |
| `playwright.config.ts` | `env: { NEXT_PUBLIC_AUTH_BYPASS: 'false' }` on `webServer` (keeps the auth specs honest while the flag is on locally) | Harmless to keep; delete with the flag |
| `.env.example` | Commented `NEXT_PUBLIC_AUTH_BYPASS` / `NEXT_PUBLIC_API_MOCK` / `NEXT_PUBLIC_MOCK_ROLE` lines | Delete the lines |
| `README.md` | "Browsing without Supabase or the backend (dev only)" section | Delete the section |

Nothing under `tests/` depends on the flags: Vitest runs with them unset, and Playwright forces the auth bypass off. `tests/mock-backend.test.ts` and the `DevRoleSwitch` cases in `tests/member-affordances.test.tsx` test the mock itself and go with it.

## What is *not* affected

- Real auth: `lib/supabase/*`, `middleware.ts`, `app/auth/callback/route.ts` are unchanged and run whenever the flag is off.
- The typed contract (`lib/types.ts`), `apiFetch`'s error handling, every component and page — the mock speaks the same routes and error `detail` strings the backend plan defines, so nothing needs rework when the API lands.
- The SSE proxy (`app/api/artifacts/[artifactId]/job/stream/route.ts`) is untouched; mock mode simply polls the job snapshot instead of opening a stream.

## Removal checklist

1. Put real values in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`) and delete the three dev flags.
2. Delete `lib/authBypass.ts` and `lib/mock/`, then fix the imports listed above (`tsc --noEmit` points at every remaining reference).
3. `npx vitest run && npx playwright test && npm run build` — all still green.
4. Delete this file.
