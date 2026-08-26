# Content Studio — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js app where a member picks a brand, writes or generates copy against the brand voice, gets it approved, generates visual artifacts, watches progress survive a closed laptop, reviews QA findings, iterates, and exports.

**Architecture:** Next.js App Router, TypeScript, server components for reads and client components for anything interactive. Supabase Auth in the browser holds the session; every data call goes to the FastAPI backend with the Supabase access token as a bearer. The frontend keeps no business rules — status transitions, format allowlists and QA verdicts are read from the API, never recomputed here. Long generations are followed over the backend's SSE stream, which is reconnectable because progress lives in a database row.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS 4, `@supabase/ssr` + `@supabase/supabase-js`, TanStack Query 5, `zod`, Vitest + Testing Library, Playwright.

**Spec:** `../Content_Studio_PRD.md`
**Backend plan:** `../backend/PLAN.md` — every endpoint used here is defined there.

## Global Constraints

- Next.js App Router only. No `pages/`.
- TypeScript strict mode. No `any` in committed code.
- The frontend never decides what is legal. It renders what the API allows and shows the API's error text. No client-side copy of `TRANSITIONS`, `ALLOWED_FORMATS`, or QA pass/fail logic.
- Supabase is used for auth only. No `supabase.from(...)` queries — all data is via the backend API.
- The access token never lands in `localStorage` by our own code; `@supabase/ssr` cookie storage is the only session store.
- Every mutating action is admin-gated in the UI **and** the backend. UI gating is affordance, not security.
- Generation progress is followed over SSE at `GET /api/v1/artifacts/{id}/job/stream`, and the page must recover correctly when reopened mid-generation.
- Artifact types are exactly: `social_post | carousel | deck | single_pager | image`. No document/contract/proposal type is ever added.
- No publishing or scheduling UI. (PRD §2)
- Every task ends with a commit.

---

## File Structure

```
frontend/
  app/
    layout.tsx                     root html, providers, theme
    page.tsx                       redirect to /brands or /login
    login/page.tsx
    auth/callback/route.ts         supabase code exchange
    (app)/
      layout.tsx                   auth guard + shell + brand switcher
      brands/page.tsx
      brands/[brandId]/page.tsx           brand overview
      brands/[brandId]/design/page.tsx    DESIGN.md editor
      brands/[brandId]/voice/page.tsx     VOICE.md editor
      brands/[brandId]/references/page.tsx
      brands/[brandId]/assets/page.tsx
      brands/[brandId]/briefs/page.tsx
      brands/[brandId]/briefs/new/page.tsx
      briefs/[briefId]/page.tsx           brief + copy stage
      artifacts/[artifactId]/page.tsx     viewer, QA, iterate, approve, export
      admin/models/page.tsx
      admin/skills/page.tsx
  components/
    shell/  AppShell.tsx  BrandSwitcher.tsx  NavLinks.tsx
    brand/  ContractEditor.tsx  ReferenceUploader.tsx  ReferenceGrid.tsx
            AssetUploader.tsx  AssetGrid.tsx
    copy/   CopyStage.tsx  CopyEditor.tsx  ApprovalBar.tsx
    generate/ GenerateForm.tsx  JobProgress.tsx
    artifact/ ArtifactViewer.tsx  QaReport.tsx  IterateBox.tsx
              VariantGrid.tsx  VersionTimeline.tsx  ExportPanel.tsx
    ui/     Button.tsx  Field.tsx  StatusBadge.tsx  EmptyState.tsx
            ErrorBanner.tsx  Spinner.tsx
  lib/
    supabase/client.ts  server.ts  middleware.ts
    api.ts                         typed fetch wrapper
    types.ts                       API types, mirrored from the backend schemas
    useJobStream.ts                SSE hook with reconnect
  middleware.ts
  tests/
```

Splitting rule: one component per interactive concern, colocated by feature folder. `ui/` holds only presentational primitives with no API knowledge.

---

## Phase 1 — Shell, auth, and the core loop

### Task 1: Project skeleton, Supabase auth, protected shell

**Files:**
- Create: `frontend/package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
- Create: `frontend/lib/supabase/client.ts`, `server.ts`, `middleware.ts`
- Create: `frontend/middleware.ts`
- Create: `frontend/app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/auth/callback/route.ts`
- Create: `frontend/app/(app)/layout.tsx`
- Test: `frontend/tests/auth.spec.ts`

**Interfaces:**
- Produces: `createBrowserSupabase()`, `createServerSupabase()`, `updateSession(request)`; `(app)/layout.tsx` which redirects unauthenticated users to `/login`.

- [ ] **Step 1: Scaffold**

```bash
npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*"
cd frontend
npm i @supabase/supabase-js @supabase/ssr @tanstack/react-query zod
npm i -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @playwright/test
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/tests/auth.spec.ts
import { test, expect } from '@playwright/test'

test('an anonymous visitor is redirected to login', async ({ page }) => {
  await page.goto('/brands')
  await expect(page).toHaveURL(/\/login/)
})

test('the login page offers email sign-in', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: /send.*link/i })).toBeVisible()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx playwright test tests/auth.spec.ts`
Expected: FAIL — `/brands` renders a 404, no redirect

- [ ] **Step 4: Write the Supabase helpers**

```typescript
// frontend/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

```typescript
// frontend/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          // Called from a Server Component during render; nothing to set there.
          try {
            items.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )
}
```

```typescript
// frontend/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )
  // Refreshes the token so a returning tab does not 401 mid-generation.
  await supabase.auth.getUser()
  return response
}
```

```typescript
// frontend/middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)$).*)'],
}
```

- [ ] **Step 5: Write the login page and callback**

```typescript
// frontend/app/login/page.tsx
'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  if (sent) return <p className="p-8">Check {email} for a sign-in link.</p>

  return (
    <form onSubmit={signIn} className="mx-auto mt-32 flex w-80 flex-col gap-3 p-4">
      <h1 className="text-xl font-semibold">Content Studio</h1>
      <label htmlFor="email" className="text-sm">Email</label>
      <input id="email" type="email" required value={email}
             onChange={(e) => setEmail(e.target.value)}
             className="rounded border px-3 py-2" />
      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Send sign-in link
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
```

```typescript
// frontend/app/auth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = await createServerSupabase()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/brands', request.url))
}
```

- [ ] **Step 6: Write the protected layout**

```typescript
// frontend/app/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return <AppShell email={data.user.email ?? ''}>{children}</AppShell>
}
```

```typescript
// frontend/app/page.tsx
import { redirect } from 'next/navigation'
export default function Home() { redirect('/brands') }
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx playwright test tests/auth.spec.ts`
Expected: 2 passed

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: next.js skeleton with supabase auth and a protected shell"
```

### Task 2: Typed API client

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/api.ts`
- Create: `frontend/app/providers.tsx`
- Modify: `frontend/app/layout.tsx`
- Test: `frontend/tests/api.test.ts`

**Interfaces:**
- Produces: types `Brand, Contract, Reference, Asset, Brief, Copy, Artifact, JobSnapshot, Provider, Skill, QaFinding, QaReport`; `apiFetch<T>(path, init?) -> Promise<T>`; `ApiError` carrying `status` and `detail`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/api.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { apiFetch, ApiError } from '@/lib/api'

beforeEach(() => { vi.restoreAllMocks() })

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))
}

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(200, { id: 'b1', name: 'Ladder' })
    await expect(apiFetch('/brands')).resolves.toEqual({ id: 'b1', name: 'Ladder' })
  })

  it('throws ApiError carrying the backend detail', async () => {
    mockFetch(409, { detail: 'copy must be approved before design can start' })
    await expect(apiFetch('/artifacts', { method: 'POST' }))
      .rejects.toMatchObject({ status: 409, detail: /must be approved/ })
  })

  it('surfaces a non-json error body as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway timeout', { status: 504 })))
    await expect(apiFetch('/brands')).rejects.toBeInstanceOf(ApiError)
  })

  it('returns undefined for a 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(apiFetch('/assets/a1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('attaches the bearer token', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200,
      headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', spy)
    await apiFetch('/me', { token: 'tok-1' })
    const headers = new Headers((spy.mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('authorization')).toBe('Bearer tok-1')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/api.test.ts`
Expected: FAIL — cannot resolve `@/lib/api`

- [ ] **Step 3: Write the types**

Mirrors the backend Pydantic schemas exactly. Where the backend returns a string enum, this uses a union of string literals so a typo is a compile error.

```typescript
// frontend/lib/types.ts
export type Role = 'admin' | 'member'

export type ArtifactType =
  | 'social_post' | 'carousel' | 'deck' | 'single_pager' | 'image'

export type GenerationMode = 'code' | 'image'

export type ArtifactStatus =
  | 'queued' | 'generating' | 'ready' | 'qa_failed'
  | 'in_review' | 'approved' | 'failed'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed'
export type CopyStatus = 'draft' | 'approved'
export type ReferenceScope = 'social' | 'presentation' | 'both'
export type ReferenceRole = 'layout' | 'typography' | 'colour_gradient' | 'overall_vibe'
export type AssetType = 'logo' | 'font' | 'headshot' | 'screenshot' | 'icon'
export type ProviderType = 'coding_agent' | 'image_provider'

export interface Me { id: string; email: string; role: Role }
export interface Brand { id: string; name: string; slug: string; created_at: string }
export interface Contract { content: string; version: number; updated_at: string | null }

export interface Reference {
  id: string; brand_id: string; file_ref: string; file_type: 'image' | 'pptx'
  scope: ReferenceScope; role: ReferenceRole
  extracted_layout_spec: string | null; url: string | null; created_at: string
}

export interface Asset {
  id: string; brand_id: string; asset_type: AssetType
  file_ref: string; label: string; url: string | null; created_at: string
}

export interface Brief {
  id: string; brand_id: string; content: string
  source: 'manual' | 'research_agent'
  research_run_id: string | null; created_at: string
}

export interface Copy {
  id: string; brief_id: string; brand_id: string; content: string
  status: CopyStatus; version: number
  generated_by_model_id: string | null; approved_by: string | null; created_at: string
}

export interface QaFinding {
  check: string; severity: 'error' | 'warning'; detail: string; page: number | null
}

export interface QaReport {
  passed: boolean; findings: QaFinding[]; checks_run: string[]; skipped: string[]
}

export interface Artifact {
  id: string; brand_id: string; brief_id: string; copy_id: string | null
  artifact_type: ArtifactType; generation_mode: GenerationMode
  model_provider_id: string; status: ArtifactStatus; version: number
  parent_artifact_id: string | null; variant_group_id: string | null
  open_design_project_ref: string | null
  export_urls: Record<string, string>
  qa_report: QaReport | Record<string, never>
  created_at: string
}

export interface JobSnapshot {
  job_id: string; state: JobState; attempts: number
  progress: { stage?: string; percent?: number; detail?: string; at?: string }
  error: string | null
}

export interface Provider {
  id: string; type: ProviderType; name: string; enabled: boolean; created_at: string
}

export interface Skill {
  id: string; name: string; storage_ref: string
  applies_to: ArtifactType[]; enabled: boolean; created_at: string
}
```

- [ ] **Step 4: Write the client**

```typescript
// frontend/lib/api.ts
import { createBrowserSupabase } from '@/lib/supabase/client'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail)
    this.name = 'ApiError'
  }
}

type FetchInit = RequestInit & { token?: string }

async function resolveToken(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit
  if (typeof window === 'undefined') return undefined
  const { data } = await createBrowserSupabase().auth.getSession()
  return data.session?.access_token
}

export async function apiFetch<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const bearer = await resolveToken(token)
  const merged = new Headers(headers)
  if (bearer) merged.set('authorization', `Bearer ${bearer}`)
  if (rest.body && !(rest.body instanceof FormData)) {
    merged.set('content-type', 'application/json')
  }

  const response = await fetch(`${BASE}${path}`, { ...rest, headers: merged })

  if (!response.ok) {
    // The backend's `detail` is the user-facing message. The frontend never
    // rewrites it — a rule the API enforces should read the same in the UI.
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body)
    } catch {
      detail = (await response.text()) || response.statusText
    }
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
```

- [ ] **Step 5: Wire TanStack Query**

```typescript
// frontend/app/providers.tsx
'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

Wrap `{children}` in `app/layout.tsx` with `<Providers>`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/api.test.ts`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add frontend/lib frontend/app/providers.tsx frontend/app/layout.tsx frontend/tests/api.test.ts
git commit -m "feat: typed api client mirroring the backend schemas"
```

### Task 3: App shell, brand list, brand switcher

**Files:**
- Create: `frontend/components/shell/AppShell.tsx`, `BrandSwitcher.tsx`, `NavLinks.tsx`
- Create: `frontend/components/ui/Button.tsx`, `Field.tsx`, `StatusBadge.tsx`, `EmptyState.tsx`, `ErrorBanner.tsx`, `Spinner.tsx`
- Create: `frontend/app/(app)/brands/page.tsx`, `frontend/app/(app)/brands/[brandId]/page.tsx`
- Test: `frontend/tests/brands.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Brand`, `Me`.
- Produces: `<AppShell email>`, `<BrandSwitcher brands current>`, `<StatusBadge status>`, `<ErrorBanner error>`, `<EmptyState title action>`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/brands.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandSwitcher } from '@/components/shell/BrandSwitcher'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'

const brands = [
  { id: 'b1', name: 'Ladder', slug: 'ladder', created_at: '' },
  { id: 'b2', name: 'Agent Loopr', slug: 'agent-loopr', created_at: '' },
]

describe('BrandSwitcher', () => {
  it('lists every brand', () => {
    render(<BrandSwitcher brands={brands} currentId="b1" />)
    expect(screen.getByRole('option', { name: 'Ladder' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Agent Loopr' })).toBeInTheDocument()
  })

  it('marks the current brand as selected', () => {
    render(<BrandSwitcher brands={brands} currentId="b2" />)
    expect(screen.getByRole('combobox')).toHaveValue('b2')
  })
})

describe('StatusBadge', () => {
  it('renders qa_failed as a readable label', () => {
    render(<StatusBadge status="qa_failed" />)
    expect(screen.getByText('QA failed')).toBeInTheDocument()
  })

  it('renders in_review as a readable label', () => {
    render(<StatusBadge status="in_review" />)
    expect(screen.getByText('In review')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('shows the title and the action', () => {
    render(<EmptyState title="No brands yet" action={<button>New brand</button>} />)
    expect(screen.getByText('No brands yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New brand' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/brands.test.tsx`
Expected: FAIL — cannot resolve `@/components/shell/BrandSwitcher`

- [ ] **Step 3: Write the UI primitives**

```tsx
// frontend/components/ui/StatusBadge.tsx
import type { ArtifactStatus, CopyStatus } from '@/lib/types'

const LABELS: Record<string, string> = {
  queued: 'Queued', generating: 'Generating', ready: 'Ready',
  qa_failed: 'QA failed', in_review: 'In review', approved: 'Approved',
  failed: 'Failed', draft: 'Draft',
}

const TONES: Record<string, string> = {
  queued: 'bg-neutral-100 text-neutral-700',
  generating: 'bg-blue-100 text-blue-800',
  ready: 'bg-emerald-100 text-emerald-800',
  qa_failed: 'bg-amber-100 text-amber-900',
  in_review: 'bg-violet-100 text-violet-800',
  approved: 'bg-emerald-600 text-white',
  failed: 'bg-red-100 text-red-800',
  draft: 'bg-neutral-100 text-neutral-700',
}

export function StatusBadge({ status }: { status: ArtifactStatus | CopyStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONES[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
```

```tsx
// frontend/components/ui/ErrorBanner.tsx
import { ApiError } from '@/lib/api'

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.detail
    : error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  )
}
```

```tsx
// frontend/components/ui/EmptyState.tsx
export function EmptyState({ title, hint, action }: {
  title: string; hint?: string; action?: React.ReactNode
}) {
  return (
    <div className="rounded border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

```tsx
// frontend/components/ui/Button.tsx
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}

const STYLES = {
  primary: 'bg-black text-white hover:bg-neutral-800',
  ghost: 'border border-neutral-300 hover:bg-neutral-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

export function Button({ variant = 'primary', className = '', ...rest }: Props) {
  return <button {...rest}
    className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${STYLES[variant]} ${className}`} />
}
```

```tsx
// frontend/components/ui/Field.tsx
export function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </label>
  )
}
```

```tsx
// frontend/components/ui/Spinner.tsx
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span role="status" aria-live="polite" className="text-sm text-neutral-500">{label}…</span>
}
```

- [ ] **Step 4: Write the shell and switcher**

```tsx
// frontend/components/shell/BrandSwitcher.tsx
'use client'
import { useRouter } from 'next/navigation'
import type { Brand } from '@/lib/types'

export function BrandSwitcher({ brands, currentId }: {
  brands: Brand[]; currentId?: string
}) {
  const router = useRouter()
  return (
    <select aria-label="Brand" value={currentId ?? ''}
            onChange={(e) => router.push(`/brands/${e.target.value}`)}
            className="rounded border px-2 py-1 text-sm">
      <option value="" disabled>Select a brand</option>
      {brands.map((brand) => (
        <option key={brand.id} value={brand.id}>{brand.name}</option>
      ))}
    </select>
  )
}
```

```tsx
// frontend/components/shell/NavLinks.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  ['', 'Overview'], ['design', 'DESIGN.md'], ['voice', 'VOICE.md'],
  ['references', 'References'], ['assets', 'Assets'], ['briefs', 'Briefs'],
] as const

export function NavLinks({ brandId }: { brandId: string }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1 text-sm">
      {SECTIONS.map(([segment, label]) => {
        const href = `/brands/${brandId}${segment ? `/${segment}` : ''}`
        const active = pathname === href
        return (
          <Link key={label} href={href}
                aria-current={active ? 'page' : undefined}
                className={`rounded px-2 py-1 ${active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100'}`}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
```

```tsx
// frontend/components/shell/AppShell.tsx
import Link from 'next/link'

export function AppShell({ email, children }: {
  email: string; children: React.ReactNode
}) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/brands" className="font-semibold">Content Studio</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/admin/models" className="hover:underline">Models</Link>
          <Link href="/admin/skills" className="hover:underline">Skills</Link>
          <span className="text-neutral-500">{email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Write the brands pages**

```tsx
// frontend/app/(app)/brands/page.tsx
'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { Brand, Me } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function BrandsPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => apiFetch<Brand[]>('/brands') })

  const create = useMutation({
    mutationFn: (brandName: string) =>
      apiFetch<Brand>('/brands', { method: 'POST', body: JSON.stringify({ name: brandName }) }),
    onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['brands'] }) },
  })

  if (brands.isLoading) return <Spinner />
  const isAdmin = me.data?.role === 'admin'

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Brands</h1>
      <ErrorBanner error={brands.error ?? create.error} />

      {brands.data?.length === 0 && (
        <EmptyState title="No brands yet"
          hint={isAdmin ? 'Create one, then write its DESIGN.md and VOICE.md.'
                        : 'An admin needs to create the first brand.'} />
      )}

      <ul className="divide-y rounded border">
        {brands.data?.map((brand) => (
          <li key={brand.id} className="px-4 py-3">
            <Link href={`/brands/${brand.id}`} className="hover:underline">{brand.name}</Link>
            <span className="ml-2 text-xs text-neutral-500">{brand.slug}</span>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <form className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); create.mutate(name) }}>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 aria-label="New brand name" placeholder="New brand name"
                 className="flex-1 rounded border px-3 py-2 text-sm" />
          <Button type="submit" disabled={!name.trim() || create.isPending}>Create</Button>
        </form>
      )}
    </section>
  )
}
```

```tsx
// frontend/app/(app)/brands/[brandId]/page.tsx
'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Brand, Contract } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { Spinner } from '@/components/ui/Spinner'

export default function BrandOverview({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const brand = useQuery({ queryKey: ['brand', brandId],
    queryFn: () => apiFetch<Brand>(`/brands/${brandId}`) })
  const design = useQuery({ queryKey: ['design', brandId],
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/design`) })
  const voice = useQuery({ queryKey: ['voice', brandId],
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/voice`) })

  if (brand.isLoading) return <Spinner />

  // PRD 12: mediocre contracts produce mediocre output regardless of engine.
  // The overview says plainly whether this brand is ready to generate.
  const ready = (design.data?.version ?? 0) > 0 && (voice.data?.version ?? 0) > 0

  return (
    <div className="grid grid-cols-[180px_1fr] gap-8">
      <NavLinks brandId={brandId} />
      <section className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">{brand.data?.name}</h1>
        {!ready && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            This brand is not ready to generate.{' '}
            {(design.data?.version ?? 0) === 0 && <Link href={`/brands/${brandId}/design`} className="underline">Write DESIGN.md</Link>}
            {(design.data?.version ?? 0) === 0 && (voice.data?.version ?? 0) === 0 && ' and '}
            {(voice.data?.version ?? 0) === 0 && <Link href={`/brands/${brandId}/voice`} className="underline">write VOICE.md</Link>}.
          </p>
        )}
        <Link href={`/brands/${brandId}/briefs/new`} className="underline">Start a brief</Link>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/brands.test.tsx`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add frontend/components frontend/app/\(app\)/brands frontend/tests/brands.test.tsx
git commit -m "feat: app shell, ui primitives and brand pages"
```

### Task 4: DESIGN.md and VOICE.md editors

**Files:**
- Create: `frontend/components/brand/ContractEditor.tsx`
- Create: `frontend/app/(app)/brands/[brandId]/design/page.tsx`
- Create: `frontend/app/(app)/brands/[brandId]/voice/page.tsx`
- Test: `frontend/tests/contract-editor.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Contract`, `Me`.
- Produces: `<ContractEditor brandId kind readOnly />` where `kind` is `'design' | 'voice'`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/contract-editor.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContractEditor } from '@/components/brand/ContractEditor'
import { renderWithQuery, mockApi } from './helpers'

describe('ContractEditor', () => {
  it('loads the current content into the textarea', async () => {
    mockApi({ '/brands/b1/design': { content: '# Ladder', version: 3, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# Ladder'))
  })

  it('shows the current version', async () => {
    mockApi({ '/brands/b1/voice': { content: '# V', version: 3, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="voice" readOnly={false} />)
    await waitFor(() => expect(screen.getByText(/version 3/i)).toBeInTheDocument())
  })

  it('disables save until the content changes', async () => {
    mockApi({ '/brands/b1/design': { content: '# a', version: 1, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeDisabled())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# b' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('hides save entirely for a member', async () => {
    mockApi({ '/brands/b1/design': { content: '# a', version: 1, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly />)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeDisabled())
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('surfaces a backend error verbatim', async () => {
    mockApi({ '/brands/b1/design': { content: '', version: 0, updated_at: null } },
             { PUT: { status: 403, detail: 'admin only' } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => screen.getByRole('textbox'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('admin only'))
  })
})
```

```tsx
// frontend/tests/helpers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

export function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

type ErrorSpec = { status: number; detail: string }

export function mockApi(
  routes: Record<string, unknown>,
  errors: Partial<Record<string, ErrorSpec>> = {},
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const failure = errors[method]
    if (failure) {
      return new Response(JSON.stringify({ detail: failure.detail }),
        { status: failure.status, headers: { 'content-type': 'application/json' } })
    }
    const path = new URL(url, 'http://x').pathname.replace('/api/v1', '')
    const body = routes[path]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/contract-editor.test.tsx`
Expected: FAIL — cannot resolve `@/components/brand/ContractEditor`

- [ ] **Step 3: Write the editor**

```tsx
// frontend/components/brand/ContractEditor.tsx
'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Contract } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const COPY = {
  design: {
    title: 'DESIGN.md',
    hint: 'Palette, type scale, spacing rhythm, component conventions, layout principles. Hex values written here are what the QA palette check enforces.',
  },
  voice: {
    title: 'VOICE.md',
    hint: 'What the brand sounds like, what it never says, claim-substantiation rules, banned AI-tell patterns. Copy generation refuses to run without this.',
  },
} as const

export function ContractEditor({ brandId, kind, readOnly }: {
  brandId: string; kind: 'design' | 'voice'; readOnly: boolean
}) {
  const queryClient = useQueryClient()
  const key = ['contract', brandId, kind]
  const [draft, setDraft] = useState<string | null>(null)

  const contract = useQuery({ queryKey: key,
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/${kind}`) })

  useEffect(() => {
    if (contract.data && draft === null) setDraft(contract.data.content)
  }, [contract.data, draft])

  const save = useMutation({
    mutationFn: (content: string) =>
      apiFetch<Contract>(`/brands/${brandId}/${kind}`, {
        method: 'PUT', body: JSON.stringify({ content }),
      }),
    onSuccess: (updated) => {
      setDraft(updated.content)
      queryClient.setQueryData(key, updated)
    },
  })

  if (contract.isLoading || draft === null) return <Spinner />
  const dirty = draft !== contract.data?.content

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{COPY[kind].title}</h1>
        <span className="text-xs text-neutral-500">
          {contract.data?.version === 0 ? 'not written yet' : `version ${contract.data?.version}`}
        </span>
      </div>
      <p className="text-sm text-neutral-500">{COPY[kind].hint}</p>
      <ErrorBanner error={contract.error ?? save.error} />
      <textarea value={draft} disabled={readOnly}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false} rows={28}
                className="w-full rounded border p-3 font-mono text-sm disabled:bg-neutral-50" />
      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {dirty && <span className="text-xs text-neutral-500">Unsaved changes</span>}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Write the two pages**

```tsx
// frontend/app/(app)/brands/[brandId]/design/page.tsx
'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me } from '@/lib/types'
import { ContractEditor } from '@/components/brand/ContractEditor'
import { NavLinks } from '@/components/shell/NavLinks'

export default function DesignPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  return (
    <div className="grid grid-cols-[180px_1fr] gap-8">
      <NavLinks brandId={brandId} />
      <ContractEditor brandId={brandId} kind="design" readOnly={me.data?.role !== 'admin'} />
    </div>
  )
}
```

`voice/page.tsx` is identical with `kind="voice"`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/contract-editor.test.tsx`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/components/brand frontend/app/\(app\)/brands frontend/tests/
git commit -m "feat: DESIGN.md and VOICE.md editors with admin-only save"
```

### Task 5: Brief creation, manual and research-backed

**Files:**
- Create: `frontend/app/(app)/brands/[brandId]/briefs/page.tsx`
- Create: `frontend/app/(app)/brands/[brandId]/briefs/new/page.tsx`
- Test: `frontend/tests/brief-new.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Brief`.
- Produces: two routes; no exported components.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/brief-new.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NewBriefPage from '@/app/(app)/brands/[brandId]/briefs/new/page'
import { renderWithQuery, mockApi } from './helpers'

const params = Promise.resolve({ brandId: 'b1' })

describe('new brief', () => {
  it('offers a manual brief by default', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => expect(screen.getByLabelText(/brief/i)).toBeInTheDocument())
  })

  it('offers pulling a research thesis', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pull.*research/i })).toBeInTheDocument())
  })

  it('lets the member edit a pulled thesis before saving', async () => {
    mockApi({ '/briefs/from-research': { id: 'br1', brand_id: 'b1',
      content: 'Pulled thesis text', source: 'research_agent',
      research_run_id: 'run-1', created_at: '' } })
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => screen.getByRole('button', { name: /pull.*research/i }))
    fireEvent.change(screen.getByLabelText(/research question/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /pull.*research/i }))
    // PRD 5.1: never auto-generate from a pulled thesis without a review step.
    await waitFor(() =>
      expect(screen.getByLabelText(/brief/i)).toHaveValue('Pulled thesis text'))
    expect(screen.getByRole('button', { name: /save brief/i })).toBeEnabled()
  })

  it('falls back to manual when no research agent is configured', async () => {
    mockApi({}, { POST: { status: 503, detail: 'no research agent configured; briefs are manual-only' } })
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => screen.getByRole('button', { name: /pull.*research/i }))
    fireEvent.change(screen.getByLabelText(/research question/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /pull.*research/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('manual-only'))
    expect(screen.getByLabelText(/brief/i)).toBeEnabled()
  })

  it('will not save an empty brief', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save brief/i })).toBeDisabled())
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/brief-new.test.tsx`
Expected: FAIL — the page module does not exist

- [ ] **Step 3: Write the page**

```tsx
// frontend/app/(app)/brands/[brandId]/briefs/new/page.tsx
'use client'
import { use, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { Brief } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

export default function NewBriefPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const router = useRouter()
  const [content, setContent] = useState('')
  const [question, setQuestion] = useState('')
  const [runId, setRunId] = useState<string | null>(null)

  const pull = useMutation({
    mutationFn: () => apiFetch<Brief>('/briefs/from-research', {
      method: 'POST', body: JSON.stringify({ brand_id: brandId, query: question }),
    }),
    onSuccess: (brief) => {
      // PRD 5.1: pre-fill for the member to edit. Never proceed automatically.
      setContent(brief.content)
      setRunId(brief.research_run_id)
    },
  })

  const save = useMutation({
    mutationFn: () => apiFetch<Brief>('/briefs', {
      method: 'POST',
      body: JSON.stringify({
        brand_id: brandId, content,
        source: runId ? 'research_agent' : 'manual',
        research_run_id: runId,
      }),
    }),
    onSuccess: (brief) => router.push(`/briefs/${brief.id}`),
  })

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold">New brief</h1>
      <ErrorBanner error={pull.error ?? save.error} />

      <div className="rounded border p-4">
        <Field label="Research question"
               hint="Optional. Pulls a thesis from the research agent to pre-fill the brief below.">
          <input value={question} onChange={(e) => setQuestion(e.target.value)}
                 className="rounded border px-3 py-2 text-sm" />
        </Field>
        <Button variant="ghost" className="mt-3"
                onClick={() => pull.mutate()}
                disabled={!question.trim() || pull.isPending}>
          {pull.isPending ? 'Researching…' : 'Pull from research'}
        </Button>
      </div>

      <Field label="Brief" hint="What this piece is for, who it is for, what it must say.">
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
                  rows={12} className="rounded border p-3 text-sm" />
      </Field>

      {runId && (
        <p className="text-xs text-neutral-500">
          Pre-filled from research run {runId}. Edit before saving.
        </p>
      )}

      <Button onClick={() => save.mutate()} disabled={!content.trim() || save.isPending}>
        Save brief
      </Button>
    </section>
  )
}
```

- [ ] **Step 4: Write the brief list page**

```tsx
// frontend/app/(app)/brands/[brandId]/briefs/page.tsx
'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Brief } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'

export default function BriefsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const briefs = useQuery({ queryKey: ['briefs', brandId],
    queryFn: () => apiFetch<Brief[]>(`/briefs?brand_id=${brandId}`) })

  return (
    <div className="grid grid-cols-[180px_1fr] gap-8">
      <NavLinks brandId={brandId} />
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Briefs</h1>
          <Link href={`/brands/${brandId}/briefs/new`} className="text-sm underline">New brief</Link>
        </div>
        {briefs.isLoading && <Spinner />}
        {briefs.data?.length === 0 && <EmptyState title="No briefs yet" />}
        <ul className="divide-y rounded border">
          {briefs.data?.map((brief) => (
            <li key={brief.id} className="px-4 py-3">
              <Link href={`/briefs/${brief.id}`} className="hover:underline">
                {brief.content.slice(0, 90) || 'Untitled brief'}
              </Link>
              {brief.source === 'research_agent' && (
                <span className="ml-2 text-xs text-neutral-500">from research</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/brief-new.test.tsx`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/app/\(app\)/brands/\[brandId\]/briefs frontend/tests/brief-new.test.tsx
git commit -m "feat: manual and research-backed brief creation with a review step"
```

### Task 6: The copy stage

Copy is generated or written, reviewed, then approved. Design cannot start before that. (PRD §5.2)

**Files:**
- Create: `frontend/components/copy/CopyStage.tsx`
- Create: `frontend/app/(app)/briefs/[briefId]/page.tsx`
- Test: `frontend/tests/copy-stage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Brief`, `Copy`, `Provider`, `Me`.
- Produces: `<CopyStage brief onApproved />` where `onApproved(copy: Copy)` fires once the copy reaches `approved`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/copy-stage.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CopyStage } from '@/components/copy/CopyStage'
import { renderWithQuery, mockApi } from './helpers'

const brief = { id: 'br1', brand_id: 'b1', content: 'launch', source: 'manual' as const,
                research_run_id: null, created_at: '' }

const draftCopy = { id: 'c1', brief_id: 'br1', brand_id: 'b1', content: 'Words.',
  status: 'draft' as const, version: 1, generated_by_model_id: null,
  approved_by: null, created_at: '' }

describe('CopyStage', () => {
  it('offers writing copy by hand as a first-class path', async () => {
    mockApi({ '/me': { id: 'u', email: 'a@b', role: 'admin' }, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    // PRD 5.2: this path must exist and must not read as a fallback.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /write it/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /generate/i })).toBeInTheDocument()
  })

  it('disables generate when the brand has no coding-agent model enabled', async () => {
    mockApi({ '/me': { id: 'u', email: 'a@b', role: 'admin' }, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /generate/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate copy/i })).toBeDisabled())
  })

  it('shows the VOICE.md error verbatim when generation is refused', async () => {
    mockApi(
      { '/me': { id: 'u', email: 'a@b', role: 'admin' },
        '/providers': [{ id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }] },
      { POST: { status: 422, detail: 'brand has no VOICE.md; author it before generating copy' } })
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /generate/i }))
    fireEvent.click(screen.getByRole('button', { name: /generate copy/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('VOICE.md'))
  })

  it('shows an approve button to an admin on a draft', async () => {
    mockApi({ '/me': { id: 'u', email: 'a@b', role: 'admin' },
              '/briefs/br1/copy': draftCopy, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={draftCopy} onApproved={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /approve copy/i })).toBeInTheDocument())
  })

  it('hides approve from a member', async () => {
    mockApi({ '/me': { id: 'u', email: 'a@b', role: 'member' }, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={draftCopy} onApproved={vi.fn()} />)
    await waitFor(() => screen.getByRole('tab', { name: /write it/i }))
    expect(screen.queryByRole('button', { name: /approve copy/i })).toBeNull()
  })

  it('warns that editing approved copy returns it to draft', async () => {
    const approved = { ...draftCopy, status: 'approved' as const, approved_by: 'u' }
    mockApi({ '/me': { id: 'u', email: 'a@b', role: 'admin' }, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={approved} onApproved={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/copy/i), { target: { value: 'New words.' } })
    expect(screen.getByText(/return.*to draft/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/copy-stage.test.tsx`
Expected: FAIL — cannot resolve `@/components/copy/CopyStage`

- [ ] **Step 3: Write the component**

```tsx
// frontend/components/copy/CopyStage.tsx
'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Brief, Copy, Me, Provider } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { StatusBadge } from '@/components/ui/StatusBadge'

type Mode = 'write' | 'generate'

export function CopyStage({ brief, copy, onApproved }: {
  brief: Brief; copy?: Copy; onApproved: (copy: Copy) => void
}) {
  const [mode, setMode] = useState<Mode>('write')
  const [text, setText] = useState(copy?.content ?? '')
  const [modelId, setModelId] = useState('')
  const [current, setCurrent] = useState<Copy | undefined>(copy)

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const providers = useQuery({ queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers') })
  const codingAgents = (providers.data ?? []).filter(
    (p) => p.type === 'coding_agent' && p.enabled)

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Copy>(`/briefs/${brief.id}/copy`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (created) => { setCurrent(created); setText(created.content) },
  })

  const update = useMutation({
    mutationFn: () => apiFetch<Copy>(`/copy/${current!.id}`, {
      method: 'PATCH', body: JSON.stringify({ content: text }) }),
    onSuccess: (updated) => setCurrent(updated),
  })

  const approve = useMutation({
    mutationFn: () => apiFetch<Copy>(`/copy/${current!.id}/approve`, { method: 'POST' }),
    onSuccess: (approvedCopy) => { setCurrent(approvedCopy); onApproved(approvedCopy) },
  })

  const isAdmin = me.data?.role === 'admin'
  const dirty = current !== undefined && text !== current.content

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Copy</h2>
        {current && <StatusBadge status={current.status} />}
        {current && <span className="text-xs text-neutral-500">v{current.version}</span>}
      </div>

      <p className="text-sm text-neutral-500">
        Copy is approved before design begins. The design agent consumes it; it does not write it.
      </p>

      {/* Both paths are peers. PRD 5.2 is explicit that hand-written copy is
          first-class, so it is the default tab and not tucked behind a link. */}
      <div role="tablist" className="flex gap-2">
        {(['write', 'generate'] as Mode[]).map((value) => (
          <button key={value} role="tab" aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded px-3 py-1 text-sm ${mode === value ? 'bg-neutral-900 text-white' : 'border'}`}>
            {value === 'write' ? 'Write it' : 'Generate from VOICE.md'}
          </button>
        ))}
      </div>

      <ErrorBanner error={create.error ?? update.error ?? approve.error} />

      {mode === 'generate' && (
        <div className="flex items-end gap-3 rounded border p-4">
          <Field label="Model">
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}
                    className="rounded border px-2 py-1 text-sm">
              <option value="">Select a model</option>
              {codingAgents.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </Field>
          <Button onClick={() => create.mutate({ generate: true, model_provider_id: modelId })}
                  disabled={!modelId || create.isPending}>
            {create.isPending ? 'Generating…' : 'Generate copy'}
          </Button>
          {codingAgents.length === 0 && (
            <span className="text-xs text-neutral-500">No coding-agent model enabled.</span>
          )}
        </div>
      )}

      <Field label="Copy">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
                  className="rounded border p-3 text-sm" />
      </Field>

      {dirty && current?.status === 'approved' && (
        <p className="text-xs text-amber-700">
          Saving will return this copy to draft and it will need approval again.
        </p>
      )}

      <div className="flex gap-3">
        {!current && (
          <Button onClick={() => create.mutate({ generate: false, content: text })}
                  disabled={!text.trim() || create.isPending}>
            Save copy
          </Button>
        )}
        {current && (
          <Button variant="ghost" onClick={() => update.mutate()}
                  disabled={!dirty || update.isPending}>
            Save changes
          </Button>
        )}
        {current && isAdmin && current.status !== 'approved' && (
          <Button onClick={() => approve.mutate()} disabled={dirty || approve.isPending}>
            Approve copy
          </Button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write the brief page**

```tsx
// frontend/app/(app)/briefs/[briefId]/page.tsx
'use client'
import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Brief, Copy } from '@/lib/types'
import { CopyStage } from '@/components/copy/CopyStage'
import { GenerateForm } from '@/components/generate/GenerateForm'
import { Spinner } from '@/components/ui/Spinner'

export default function BriefPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = use(params)
  const [approvedCopy, setApprovedCopy] = useState<Copy | null>(null)
  const brief = useQuery({ queryKey: ['brief', briefId],
    queryFn: () => apiFetch<Brief>(`/briefs/${briefId}`) })

  if (brief.isLoading || !brief.data) return <Spinner />

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section>
        <h1 className="text-lg font-semibold">Brief</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm">{brief.data.content}</p>
      </section>

      <CopyStage brief={brief.data} onApproved={setApprovedCopy} />

      {approvedCopy ? (
        <GenerateForm brandId={brief.data.brand_id} briefId={brief.data.id}
                      copyId={approvedCopy.id} />
      ) : (
        <p className="rounded border border-dashed p-4 text-sm text-neutral-500">
          Design unlocks once the copy is approved.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/copy-stage.test.tsx`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/components/copy frontend/app/\(app\)/briefs frontend/tests/copy-stage.test.tsx
git commit -m "feat: copy stage with hand-written and generated paths, gated on approval"
```

### Task 7: Generate form and live progress

**Files:**
- Create: `frontend/lib/useJobStream.ts`
- Create: `frontend/components/generate/GenerateForm.tsx`, `JobProgress.tsx`
- Test: `frontend/tests/job-stream.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Artifact`, `JobSnapshot`, `Provider`.
- Produces: `useJobStream(artifactId) -> { snapshot, connected, error }`; `<GenerateForm brandId briefId copyId />`; `<JobProgress artifactId />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/job-stream.test.tsx
import { renderHook, act, waitFor, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useJobStream } from '@/lib/useJobStream'
import { JobProgress } from '@/components/generate/JobProgress'
import { renderWithQuery, mockApi } from './helpers'

class FakeEventSource {
  static last: FakeEventSource
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) { FakeEventSource.last = this }
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }) }
  fail() { this.onerror?.() }
  close() { this.closed = true }
}

beforeEach(() => { vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource) })

describe('useJobStream', () => {
  it('exposes the latest snapshot', async () => {
    const { result } = renderHook(() => useJobStream('a1'))
    act(() => FakeEventSource.last.emit({
      job_id: 'j1', state: 'running', attempts: 1,
      progress: { stage: 'generating', percent: 30 }, error: null }))
    await waitFor(() => expect(result.current.snapshot?.progress.percent).toBe(30))
  })

  it('closes the stream once the job is terminal', async () => {
    const { result } = renderHook(() => useJobStream('a1'))
    act(() => FakeEventSource.last.emit({
      job_id: 'j1', state: 'succeeded', attempts: 1,
      progress: { stage: 'done', percent: 100 }, error: null }))
    await waitFor(() => expect(FakeEventSource.last.closed).toBe(true))
    expect(result.current.snapshot?.state).toBe('succeeded')
  })

  it('reconnects after an error rather than giving up', async () => {
    const first = () => FakeEventSource.last
    renderHook(() => useJobStream('a1'))
    const original = first()
    act(() => original.fail())
    await waitFor(() => expect(FakeEventSource.last).not.toBe(original))
  })

  it('does not open a stream without an artifact id', () => {
    const before = FakeEventSource.last
    renderHook(() => useJobStream(undefined))
    expect(FakeEventSource.last).toBe(before)
  })
})

describe('JobProgress', () => {
  it('recovers the current stage when opened mid-generation', async () => {
    // PRD 7.1: a member can leave and come back.
    mockApi({ '/artifacts/a1/job': { job_id: 'j1', state: 'running', attempts: 1,
      progress: { stage: 'qa', percent: 70 }, error: null } })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() => expect(screen.getByText(/quality checks/i)).toBeInTheDocument())
  })

  it('shows the retry count when a job has been retried', async () => {
    mockApi({ '/artifacts/a1/job': { job_id: 'j1', state: 'running', attempts: 2,
      progress: { stage: 'generating', percent: 30 }, error: null } })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() => expect(screen.getByText(/attempt 2/i)).toBeInTheDocument())
  })

  it('shows the failure reason on a failed job', async () => {
    mockApi({ '/artifacts/a1/job': { job_id: 'j1', state: 'failed', attempts: 3,
      progress: { stage: 'generating', percent: 30 }, error: 'open-design unreachable' } })
    renderWithQuery(<JobProgress artifactId="a1" />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('open-design unreachable'))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/job-stream.test.tsx`
Expected: FAIL — cannot resolve `@/lib/useJobStream`

- [ ] **Step 3: Write the hook**

```typescript
// frontend/lib/useJobStream.ts
'use client'
import { useEffect, useRef, useState } from 'react'
import type { JobSnapshot } from '@/lib/types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'
const TERMINAL = new Set(['succeeded', 'failed'])
const RECONNECT_MS = 2000

/**
 * Follow one generation job.
 *
 * PRD 7.1 requires reconnectable progress: a member can close a laptop and come
 * back. The backend keeps progress in a database row, so recovery is just
 * reading the row again — this hook only has to survive a dropped socket.
 */
export function useJobStream(artifactId: string | undefined) {
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!artifactId) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    function open() {
      if (cancelled) return
      const source = new EventSource(`${BASE}/artifacts/${artifactId}/job/stream`)
      sourceRef.current = source
      setConnected(true)

      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as JobSnapshot
        setSnapshot(payload)
        setError(null)
        if (TERMINAL.has(payload.state)) {
          source.close()
          setConnected(false)
          cancelled = true
        }
      }

      source.onerror = () => {
        source.close()
        setConnected(false)
        if (!cancelled) retryTimer = setTimeout(open, RECONNECT_MS)
      }
    }

    open()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      sourceRef.current?.close()
    }
  }, [artifactId])

  return { snapshot, connected, error }
}
```

- [ ] **Step 4: Write the progress component**

```tsx
// frontend/components/generate/JobProgress.tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useJobStream } from '@/lib/useJobStream'
import type { JobSnapshot } from '@/lib/types'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const STAGE_LABELS: Record<string, string> = {
  queued: 'Waiting for a free generation slot',
  starting: 'Starting',
  syncing_brand: 'Syncing brand system, assets and fonts',
  generating: 'Generating with open-design',
  qa: 'Running quality checks',
  done: 'Done',
}

export function JobProgress({ artifactId }: { artifactId: string }) {
  // The snapshot query is what makes a reopened page correct immediately;
  // the stream then takes over for live updates.
  const initial = useQuery({ queryKey: ['job', artifactId],
    queryFn: () => apiFetch<JobSnapshot>(`/artifacts/${artifactId}/job`) })
  const { snapshot: live } = useJobStream(artifactId)
  const snapshot = live ?? initial.data
  if (!snapshot) return null

  const percent = snapshot.progress.percent ?? 0
  const stage = snapshot.progress.stage ?? snapshot.state

  return (
    <div className="flex flex-col gap-2 rounded border p-4">
      <div className="flex items-center justify-between text-sm">
        <span>{STAGE_LABELS[stage] ?? stage}</span>
        <span className="text-neutral-500">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-100">
        <div className="h-full bg-neutral-900 transition-all"
             style={{ width: `${percent}%` }} role="progressbar"
             aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} />
      </div>
      {snapshot.attempts > 1 && (
        <span className="text-xs text-neutral-500">Attempt {snapshot.attempts}</span>
      )}
      {snapshot.progress.detail && (
        <span className="text-xs text-neutral-500">{snapshot.progress.detail}</span>
      )}
      {snapshot.state === 'failed' && <ErrorBanner error={new Error(snapshot.error ?? 'Generation failed')} />}
    </div>
  )
}
```

- [ ] **Step 5: Write the generate form**

```tsx
// frontend/components/generate/GenerateForm.tsx
'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { Artifact, ArtifactType, Provider } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { JobProgress } from '@/components/generate/JobProgress'

const TYPES: { value: ArtifactType; label: string; mode: 'code' | 'image' }[] = [
  { value: 'social_post', label: 'Social post', mode: 'code' },
  { value: 'carousel', label: 'Carousel', mode: 'code' },
  { value: 'deck', label: 'Deck', mode: 'code' },
  { value: 'single_pager', label: 'Single-pager', mode: 'code' },
  { value: 'image', label: 'Image', mode: 'image' },
]

const MAX_VARIANTS = 8

export function GenerateForm({ brandId, briefId, copyId }: {
  brandId: string; briefId: string; copyId: string
}) {
  const router = useRouter()
  const [artifactType, setArtifactType] = useState<ArtifactType>('carousel')
  const [modelId, setModelId] = useState('')
  const [variants, setVariants] = useState(1)
  const [created, setCreated] = useState<Artifact[]>([])

  const providers = useQuery({ queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers') })

  const wantedType = TYPES.find((t) => t.value === artifactType)!.mode === 'image'
    ? 'image_provider' : 'coding_agent'
  const options = (providers.data ?? []).filter((p) => p.enabled && p.type === wantedType)

  const generate = useMutation({
    mutationFn: () => apiFetch<Artifact[]>('/artifacts', {
      method: 'POST',
      body: JSON.stringify({ brand_id: brandId, brief_id: briefId, copy_id: copyId,
                             artifact_type: artifactType, model_provider_id: modelId,
                             variants }),
    }),
    onSuccess: setCreated,
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Design</h2>
      <ErrorBanner error={generate.error} />

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Artifact">
          <select value={artifactType}
                  onChange={(e) => { setArtifactType(e.target.value as ArtifactType); setModelId('') }}
                  className="rounded border px-2 py-1 text-sm">
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Model">
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}
                  className="rounded border px-2 py-1 text-sm">
            <option value="">Select a model</option>
            {options.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Variants" hint="One brief, N options.">
          <input type="number" min={1} max={MAX_VARIANTS} value={variants}
                 onChange={(e) => setVariants(Number(e.target.value))}
                 className="w-20 rounded border px-2 py-1 text-sm" />
        </Field>

        <Button onClick={() => generate.mutate()} disabled={!modelId || generate.isPending}>
          Generate
        </Button>
      </div>

      {options.length === 0 && !providers.isLoading && (
        <p className="text-xs text-neutral-500">
          No {wantedType.replace('_', ' ')} is enabled. An admin adds one under Models.
        </p>
      )}

      {created.map((artifact) => (
        <div key={artifact.id} className="flex flex-col gap-2">
          <JobProgress artifactId={artifact.id} />
          <button onClick={() => router.push(`/artifacts/${artifact.id}`)}
                  className="self-start text-sm underline">
            Open artifact
          </button>
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/job-stream.test.tsx`
Expected: 7 passed

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/useJobStream.ts frontend/components/generate frontend/tests/job-stream.test.tsx
git commit -m "feat: generate form with variants and reconnectable live progress"
```

### Task 8: Artifact viewer — QA report, iteration, approval, export

**Files:**
- Create: `frontend/components/artifact/ArtifactViewer.tsx`, `QaReport.tsx`, `IterateBox.tsx`, `ExportPanel.tsx`, `VariantGrid.tsx`, `VersionTimeline.tsx`
- Create: `frontend/app/(app)/artifacts/[artifactId]/page.tsx`
- Test: `frontend/tests/artifact.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Artifact`, `QaReport`, `Me`.
- Produces: `<ArtifactViewer artifact />`, `<QaReportPanel report status onRerun />`, `<IterateBox artifactId />`, `<ExportPanel artifact />`, `<VariantGrid artifactId />`, `<VersionTimeline artifactId />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/artifact.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QaReportPanel } from '@/components/artifact/QaReport'
import { ExportPanel } from '@/components/artifact/ExportPanel'
import { IterateBox } from '@/components/artifact/IterateBox'
import { renderWithQuery, mockApi } from './helpers'

const passing = { passed: true, findings: [], checks_run: ['overflow', 'fill'], skipped: [] }
const failing = {
  passed: false,
  findings: [
    { check: 'overflow', severity: 'error' as const, page: null,
      detail: '<h1> content 812x40 exceeds box 400x40: "A very long headline"' },
    { check: 'fill', severity: 'error' as const, page: 3,
      detail: 'page 3 is 12% filled, below the 35% threshold — dead space' },
  ],
  checks_run: ['overflow', 'fill', 'palette'],
  skipped: ['determinism'],
}

const artifact = {
  id: 'a1', brand_id: 'b1', brief_id: 'br1', copy_id: 'c1',
  artifact_type: 'carousel' as const, generation_mode: 'code' as const,
  model_provider_id: 'p1', status: 'ready' as const, version: 1,
  parent_artifact_id: null, variant_group_id: null,
  open_design_project_ref: 'proj_42',
  export_urls: { png: 'http://od/e/1.png' }, qa_report: passing, created_at: '',
}

describe('QaReportPanel', () => {
  it('says nothing was wrong when the gate passed', () => {
    renderWithQuery(<QaReportPanel report={passing} status="ready" onRerun={vi.fn()} />)
    expect(screen.getByText(/passed/i)).toBeInTheDocument()
  })

  it('lists every finding with its check name', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText(/overflow/)).toBeInTheDocument()
    expect(screen.getByText(/dead space/)).toBeInTheDocument()
  })

  it('shows which page a finding is on', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText(/page 3/i)).toBeInTheDocument()
  })

  it('names the checks that were skipped', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText(/determinism/)).toBeInTheDocument()
  })
})

describe('ExportPanel', () => {
  it('offers exports on a ready artifact', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' },
              '/me': { id: 'u', email: 'a@b', role: 'admin' } })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /png/i })).toHaveAttribute('href', 'https://signed/1.png'))
  })

  it('explains that a final export needs approval', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' },
              '/me': { id: 'u', email: 'a@b', role: 'admin' } })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() =>
      expect(screen.getByText(/approved.*final/i)).toBeInTheDocument())
  })

  it('offers the zip only for a carousel', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' },
              '/me': { id: 'u', email: 'a@b', role: 'admin' } })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /all cards/i })).toBeInTheDocument())
  })
})

describe('IterateBox', () => {
  it('sends the instruction and reports the new version', async () => {
    mockApi({ '/artifacts/a1/iterate': { ...artifact, id: 'a2', version: 2,
      parent_artifact_id: 'a1', status: 'queued' } })
    renderWithQuery(<IterateBox artifactId="a1" />)
    fireEvent.change(screen.getByLabelText(/what should change/i),
                     { target: { value: 'bigger headline' } })
    fireEvent.click(screen.getByRole('button', { name: /apply edit/i }))
    await waitFor(() => expect(screen.getByText(/version 2/i)).toBeInTheDocument())
  })

  it('will not send an empty instruction', () => {
    mockApi({})
    renderWithQuery(<IterateBox artifactId="a1" />)
    expect(screen.getByRole('button', { name: /apply edit/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/artifact.test.tsx`
Expected: FAIL — cannot resolve `@/components/artifact/QaReport`

- [ ] **Step 3: Write the QA panel**

```tsx
// frontend/components/artifact/QaReport.tsx
'use client'
import type { ArtifactStatus, QaReport } from '@/lib/types'
import { Button } from '@/components/ui/Button'

const CHECK_LABELS: Record<string, string> = {
  structure: 'File structure',
  overflow: 'Text overflow',
  bounds: 'Elements inside the canvas',
  tokens: 'Unbroken prices, dates and identifiers',
  fill: 'Dead space',
  palette: 'Brand palette',
  fonts: 'Brand fonts actually rendered',
  determinism: 'Two identical builds match',
  qa_pipeline: 'QA pipeline',
}

export function QaReportPanel({ report, status, onRerun }: {
  report: QaReport | Record<string, never>
  status: ArtifactStatus
  onRerun: () => void
}) {
  if (!('passed' in report)) {
    return <p className="text-sm text-neutral-500">Quality checks have not run yet.</p>
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Quality checks {report.passed ? 'passed' : 'failed'}
        </h2>
        <Button variant="ghost" onClick={onRerun}>Re-run checks</Button>
      </div>

      {report.findings.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing to fix. {report.checks_run.length} checks ran.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {report.findings.map((finding, index) => (
          <li key={index}
              className={`rounded border-l-4 px-3 py-2 text-sm ${
                finding.severity === 'error'
                  ? 'border-red-500 bg-red-50' : 'border-amber-400 bg-amber-50'}`}>
            <span className="font-medium">{CHECK_LABELS[finding.check] ?? finding.check}</span>
            {finding.page !== null && (
              <span className="ml-2 text-xs text-neutral-600">page {finding.page}</span>
            )}
            <p className="mt-1 text-neutral-800">{finding.detail}</p>
          </li>
        ))}
      </ul>

      {report.skipped.length > 0 && (
        <p className="text-xs text-neutral-500">
          Not run for this artifact: {report.skipped.map((c) => CHECK_LABELS[c] ?? c).join(', ')}.
        </p>
      )}

      {status === 'qa_failed' && (
        <p className="text-xs text-neutral-600">
          Iterate below to fix these, or re-run the checks after changing DESIGN.md.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Write the iterate box, export panel, variants and timeline**

```tsx
// frontend/components/artifact/IterateBox.tsx
'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { JobProgress } from '@/components/generate/JobProgress'

export function IterateBox({ artifactId }: { artifactId: string }) {
  const [instruction, setInstruction] = useState('')
  const [child, setChild] = useState<Artifact | null>(null)

  const iterate = useMutation({
    mutationFn: () => apiFetch<Artifact>(`/artifacts/${artifactId}/iterate`, {
      method: 'POST', body: JSON.stringify({ instruction }) }),
    onSuccess: (created) => { setChild(created); setInstruction('') },
  })

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-base font-semibold">Iterate</h2>
      <ErrorBanner error={iterate.error} />
      <Field label="What should change?"
             hint="Every edit creates a new version. Nothing is overwritten.">
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
                  rows={3} className="rounded border p-2 text-sm" />
      </Field>
      <Button onClick={() => iterate.mutate()}
              disabled={!instruction.trim() || iterate.isPending}>
        Apply edit
      </Button>
      {child && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Created <Link href={`/artifacts/${child.id}`} className="underline">
              version {child.version}
            </Link>.
          </p>
          <JobProgress artifactId={child.id} />
        </div>
      )}
    </section>
  )
}
```

```tsx
// frontend/components/artifact/ExportPanel.tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

export function ExportPanel({ artifact }: { artifact: Artifact }) {
  const exports = useQuery({
    queryKey: ['exports', artifact.id, artifact.version],
    queryFn: () => apiFetch<Record<string, string>>(`/artifacts/${artifact.id}/exports`),
    enabled: ['ready', 'in_review', 'approved'].includes(artifact.status),
  })

  if (!['ready', 'in_review', 'approved'].includes(artifact.status)) {
    return <p className="text-sm text-neutral-500">Nothing to export yet.</p>
  }

  return (
    <section className="flex flex-col gap-2 rounded border p-4">
      <h2 className="text-base font-semibold">Export</h2>
      <ErrorBanner error={exports.error} />
      <div className="flex flex-wrap gap-3">
        {Object.entries(exports.data ?? {}).map(([format, url]) => (
          <a key={format} href={url} className="text-sm underline">
            Download {format.toUpperCase()}
          </a>
        ))}
        {artifact.artifact_type === 'carousel' && (
          <a href={`${BASE}/artifacts/${artifact.id}/exports/png.zip`} className="text-sm underline">
            Download all cards (ZIP)
          </a>
        )}
      </div>
      {artifact.status !== 'approved' && (
        <p className="text-xs text-neutral-500">
          These are working exports. An artifact must be approved before a final export.
        </p>
      )}
    </section>
  )
}
```

```tsx
// frontend/components/artifact/VersionTimeline.tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { StatusBadge } from '@/components/ui/StatusBadge'

export function VersionTimeline({ artifactId }: { artifactId: string }) {
  const lineage = useQuery({ queryKey: ['lineage', artifactId],
    queryFn: () => apiFetch<Artifact[]>(`/artifacts/${artifactId}/lineage`) })
  if ((lineage.data?.length ?? 0) < 2) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Versions</h2>
      <ol className="flex flex-col gap-1 text-sm">
        {lineage.data?.map((version) => (
          <li key={version.id} className="flex items-center gap-2">
            <Link href={`/artifacts/${version.id}`}
                  aria-current={version.id === artifactId ? 'page' : undefined}
                  className={version.id === artifactId ? 'font-semibold' : 'underline'}>
              v{version.version}
            </Link>
            <StatusBadge status={version.status} />
          </li>
        ))}
      </ol>
    </section>
  )
}
```

```tsx
// frontend/components/artifact/VariantGrid.tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { StatusBadge } from '@/components/ui/StatusBadge'

export function VariantGrid({ artifactId }: { artifactId: string }) {
  const variants = useQuery({ queryKey: ['variants', artifactId],
    queryFn: () => apiFetch<Artifact[]>(`/artifacts/${artifactId}/variants`) })
  if ((variants.data?.length ?? 0) < 2) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Options from this brief</h2>
      <div className="grid grid-cols-3 gap-3">
        {variants.data?.map((variant, index) => (
          <Link key={variant.id} href={`/artifacts/${variant.id}`}
                className={`rounded border p-3 text-sm hover:bg-neutral-50 ${
                  variant.id === artifactId ? 'ring-2 ring-neutral-900' : ''}`}>
            <div className="flex items-center justify-between">
              <span>Option {index + 1}</span>
              <StatusBadge status={variant.status} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Write the viewer and the page**

```tsx
// frontend/components/artifact/ArtifactViewer.tsx
'use client'
import type { Artifact } from '@/lib/types'

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const preview = artifact.export_urls?.png ?? artifact.export_urls?.jpg
  if (!preview) {
    return (
      <div className="rounded border border-dashed p-10 text-center text-sm text-neutral-500">
        No preview yet.
      </div>
    )
  }
  return (
    <img src={preview} alt={`${artifact.artifact_type} preview, version ${artifact.version}`}
         className="w-full rounded border" />
  )
}
```

```tsx
// frontend/app/(app)/artifacts/[artifactId]/page.tsx
'use client'
import { use } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Artifact, Me } from '@/lib/types'
import { ArtifactViewer } from '@/components/artifact/ArtifactViewer'
import { QaReportPanel } from '@/components/artifact/QaReport'
import { IterateBox } from '@/components/artifact/IterateBox'
import { ExportPanel } from '@/components/artifact/ExportPanel'
import { VariantGrid } from '@/components/artifact/VariantGrid'
import { VersionTimeline } from '@/components/artifact/VersionTimeline'
import { JobProgress } from '@/components/generate/JobProgress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = use(params)
  const queryClient = useQueryClient()
  const key = ['artifact', artifactId]

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const artifact = useQuery({ queryKey: key,
    queryFn: () => apiFetch<Artifact>(`/artifacts/${artifactId}`),
    // While a job is live the row changes underneath us.
    refetchInterval: (query) =>
      ['queued', 'generating'].includes(
        (query.state.data as Artifact | undefined)?.status ?? '') ? 3000 : false,
  })

  function action(path: string) {
    return apiFetch<Artifact>(`/artifacts/${artifactId}/${path}`, { method: 'POST' })
  }
  const move = useMutation({
    mutationFn: action,
    onSuccess: (updated) => queryClient.setQueryData(key, updated),
  })

  if (artifact.isLoading || !artifact.data) return <Spinner />
  const row = artifact.data
  const isAdmin = me.data?.role === 'admin'

  return (
    <div className="grid grid-cols-[1fr_360px] gap-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            {row.artifact_type.replace('_', ' ')} v{row.version}
          </h1>
          <StatusBadge status={row.status} />
        </div>
        {['queued', 'generating'].includes(row.status) && <JobProgress artifactId={row.id} />}
        <ArtifactViewer artifact={row} />
        <VariantGrid artifactId={row.id} />
      </div>

      <aside className="flex flex-col gap-6">
        <ErrorBanner error={move.error} />
        <QaReportPanel report={row.qa_report} status={row.status}
                       onRerun={() => move.mutate('qa')} />

        <section className="flex flex-col gap-2 rounded border p-4">
          <h2 className="text-base font-semibold">Approval</h2>
          <div className="flex flex-wrap gap-2">
            {row.status === 'ready' && (
              <Button onClick={() => move.mutate('submit')}>Submit for review</Button>
            )}
            {row.status === 'in_review' && isAdmin && (
              <>
                <Button onClick={() => move.mutate('approve')}>Approve</Button>
                <Button variant="ghost" onClick={() => move.mutate('reject')}>Send back</Button>
              </>
            )}
            {row.status === 'in_review' && !isAdmin && (
              <p className="text-sm text-neutral-500">Waiting on an admin.</p>
            )}
            {row.status === 'approved' && (
              <p className="text-sm text-neutral-500">Approved. Iterating creates a new version.</p>
            )}
            {row.status === 'qa_failed' && (
              <p className="text-sm text-neutral-500">
                Quality checks must pass before this can go to review.
              </p>
            )}
          </div>
        </section>

        <ExportPanel artifact={row} />
        <IterateBox artifactId={row.id} />
        <VersionTimeline artifactId={row.id} />
      </aside>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/artifact.test.tsx`
Expected: 9 passed

- [ ] **Step 7: Commit**

```bash
git add frontend/components/artifact frontend/app/\(app\)/artifacts frontend/tests/artifact.test.tsx
git commit -m "feat: artifact viewer with qa report, iteration, approval and export"
```

---

## Phase 2 — Brand governance UI

### Task 9: Reference library

**Files:**
- Create: `frontend/components/brand/ReferenceUploader.tsx`, `ReferenceGrid.tsx`
- Create: `frontend/app/(app)/brands/[brandId]/references/page.tsx`
- Test: `frontend/tests/references.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Reference`.
- Produces: `<ReferenceUploader brandId />`, `<ReferenceGrid brandId readOnly />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/references.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReferenceUploader } from '@/components/brand/ReferenceUploader'
import { ReferenceGrid } from '@/components/brand/ReferenceGrid'
import { renderWithQuery, mockApi } from './helpers'

const refs = [
  { id: 'r1', brand_id: 'b1', file_ref: 'k1', file_type: 'image' as const,
    scope: 'social' as const, role: 'layout' as const,
    extracted_layout_spec: null, url: 'https://s/1.png', created_at: '' },
  { id: 'r2', brand_id: 'b1', file_ref: 'k2', file_type: 'pptx' as const,
    scope: 'presentation' as const, role: 'layout' as const,
    extracted_layout_spec: 'slide_size: 13.33x7.50in', url: 'https://s/2.pptx', created_at: '' },
]

describe('ReferenceUploader', () => {
  it('requires both a scope and a role', () => {
    mockApi({})
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    expect(screen.getByLabelText(/scope/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument()
  })

  it('explains that tagging beats describing', () => {
    mockApi({})
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    expect(screen.getByText(/tag.*don't describe/i)).toBeInTheDocument()
  })

  it('surfaces a corrupt-pptx rejection verbatim', async () => {
    mockApi({}, { POST: { status: 422, detail: 'unreadable pptx: File is not a zip file' } })
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    const input = screen.getByLabelText(/file/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.pptx')] } })
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unreadable pptx'))
  })
})

describe('ReferenceGrid', () => {
  it('shows the scope and role tags on each reference', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getAllByText(/layout/i).length).toBe(2))
    expect(screen.getByText('social')).toBeInTheDocument()
    expect(screen.getByText('presentation')).toBeInTheDocument()
  })

  it('marks a pptx as parsed', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getByText(/layout spec extracted/i)).toBeInTheDocument())
  })

  it('sets expectations about what references do', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    // PRD 4.3: consistent brand feel, not pixel-exact reproduction.
    await waitFor(() =>
      expect(screen.getByText(/consistent brand feel, not pixel-exact/i)).toBeInTheDocument())
  })

  it('hides delete from a member', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly />)
    await waitFor(() => screen.getByText('social'))
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/references.test.tsx`
Expected: FAIL — cannot resolve `@/components/brand/ReferenceUploader`

- [ ] **Step 3: Write the uploader**

```tsx
// frontend/components/brand/ReferenceUploader.tsx
'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Reference, ReferenceRole, ReferenceScope } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const SCOPES: ReferenceScope[] = ['social', 'presentation', 'both']
const ROLES: ReferenceRole[] = ['layout', 'typography', 'colour_gradient', 'overall_vibe']

export function ReferenceUploader({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<ReferenceScope>('social')
  const [role, setRole] = useState<ReferenceRole>('layout')

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a file first')
      const body = new FormData()
      body.append('file', file)
      body.append('scope', scope)
      body.append('role', role)
      return apiFetch<Reference>(`/brands/${brandId}/references`, { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['references', brandId] })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-base font-semibold">Add a reference</h2>
      <p className="text-sm text-neutral-500">
        Tag it, don&apos;t describe it. The agent reads the image at generation time;
        the tags decide which generations it reaches. A .pptx is parsed into a
        layout spec on upload.
      </p>
      <ErrorBanner error={upload.error} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="File">
          <input ref={fileRef} type="file" accept="image/*,.pptx" className="text-sm" />
        </Field>
        <Field label="Scope" hint="Which generations may see it.">
          <select value={scope} onChange={(e) => setScope(e.target.value as ReferenceScope)}
                  className="rounded border px-2 py-1 text-sm">
            {SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Role" hint="What to take from it.">
          <select value={role} onChange={(e) => setRole(e.target.value as ReferenceRole)}
                  className="rounded border px-2 py-1 text-sm">
            {ROLES.map((value) => (
              <option key={value} value={value}>{value.replace('_', ' ')}</option>
            ))}
          </select>
        </Field>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending}>Upload</Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write the grid and the page**

```tsx
// frontend/components/brand/ReferenceGrid.tsx
'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Reference } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'

export function ReferenceGrid({ brandId, readOnly }: {
  brandId: string; readOnly: boolean
}) {
  const queryClient = useQueryClient()
  const references = useQuery({ queryKey: ['references', brandId],
    queryFn: () => apiFetch<Reference[]>(`/brands/${brandId}/references`) })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/references/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['references', brandId] }),
  })

  if (references.isLoading) return <Spinner />
  if (references.data?.length === 0) {
    return <EmptyState title="No references yet"
             hint="Upload screenshots and .pptx files, then tag their scope and role." />
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        References produce consistent brand feel, not pixel-exact template
        reproduction. Anything that must be identical every run does not belong here.
      </p>
      <ul className="grid grid-cols-3 gap-4">
        {references.data?.map((reference) => (
          <li key={reference.id} className="flex flex-col gap-2 rounded border p-3">
            {reference.file_type === 'image' && reference.url ? (
              <img src={reference.url} alt="" className="h-32 w-full rounded object-cover" />
            ) : (
              <div className="flex h-32 items-center justify-center rounded bg-neutral-100 text-xs">
                PPTX
              </div>
            )}
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="rounded bg-neutral-900 px-2 py-0.5 text-white">{reference.scope}</span>
              <span className="rounded bg-neutral-100 px-2 py-0.5">
                {reference.role.replace('_', ' ')}
              </span>
            </div>
            {reference.extracted_layout_spec && (
              <span className="text-xs text-emerald-700">Layout spec extracted</span>
            )}
            {!readOnly && (
              <Button variant="ghost" onClick={() => remove.mutate(reference.id)}>Remove</Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

```tsx
// frontend/app/(app)/brands/[brandId]/references/page.tsx
'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { ReferenceUploader } from '@/components/brand/ReferenceUploader'
import { ReferenceGrid } from '@/components/brand/ReferenceGrid'

export default function ReferencesPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const isAdmin = me.data?.role === 'admin'
  return (
    <div className="grid grid-cols-[180px_1fr] gap-8">
      <NavLinks brandId={brandId} />
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">References</h1>
        {isAdmin && <ReferenceUploader brandId={brandId} />}
        <ReferenceGrid brandId={brandId} readOnly={!isAdmin} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/references.test.tsx`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/components/brand frontend/app/\(app\)/brands/\[brandId\]/references frontend/tests/references.test.tsx
git commit -m "feat: reference library with scope and role tagging"
```

### Task 10: Asset library, with fonts made visible

**Files:**
- Create: `frontend/components/brand/AssetUploader.tsx`, `AssetGrid.tsx`
- Create: `frontend/app/(app)/brands/[brandId]/assets/page.tsx`
- Test: `frontend/tests/assets.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Asset`, `Contract`.
- Produces: `<AssetUploader brandId />`, `<AssetGrid brandId readOnly />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/assets.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AssetUploader } from '@/components/brand/AssetUploader'
import { AssetGrid } from '@/components/brand/AssetGrid'
import { renderWithQuery, mockApi } from './helpers'

const assets = [
  { id: 'a1', brand_id: 'b1', asset_type: 'logo' as const, file_ref: 'k1',
    label: 'Primary', url: 'https://s/logo.svg', created_at: '' },
  { id: 'a2', brand_id: 'b1', asset_type: 'font' as const, file_ref: 'k2',
    label: 'Inter', url: 'https://s/Inter.ttf', created_at: '' },
]

describe('AssetUploader', () => {
  it('offers every asset type including font', () => {
    mockApi({})
    renderWithQuery(<AssetUploader brandId="b1" />)
    const select = screen.getByLabelText(/type/i)
    expect(select).toHaveTextContent('font')
    expect(select).toHaveTextContent('logo')
  })

  it('surfaces the font-extension rejection verbatim', async () => {
    mockApi({}, { POST: { status: 422,
      detail: "font file must be one of ['.otf', '.ttf', '.woff', '.woff2']" } })
    renderWithQuery(<AssetUploader brandId="b1" />)
    fireEvent.change(screen.getByLabelText(/file/i),
                     { target: { files: [new File(['x'], 'inter.png')] } })
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('.woff2'))
  })
})

describe('AssetGrid', () => {
  it('groups fonts separately from images', async () => {
    mockApi({ '/brands/b1/assets': assets })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getByText(/fonts/i)).toBeInTheDocument())
    expect(screen.getByText('Inter')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('warns when a brand has no fonts uploaded', async () => {
    mockApi({ '/brands/b1/assets': [assets[0]] })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    // PRD 4.4: without self-hosted fonts, typography silently falls back.
    await waitFor(() =>
      expect(screen.getByText(/no brand fonts/i)).toBeInTheDocument())
  })

  it('does not warn once a font exists', async () => {
    mockApi({ '/brands/b1/assets': assets })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    await waitFor(() => screen.getByText('Inter'))
    expect(screen.queryByText(/no brand fonts/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/assets.test.tsx`
Expected: FAIL — cannot resolve `@/components/brand/AssetUploader`

- [ ] **Step 3: Write the uploader**

```tsx
// frontend/components/brand/AssetUploader.tsx
'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Asset, AssetType } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const TYPES: AssetType[] = ['logo', 'font', 'headshot', 'screenshot', 'icon']

export function AssetUploader({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [assetType, setAssetType] = useState<AssetType>('logo')
  const [label, setLabel] = useState('')

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a file first')
      const body = new FormData()
      body.append('file', file)
      body.append('asset_type', assetType)
      body.append('label', label || file.name)
      return apiFetch<Asset>(`/brands/${brandId}/assets`, { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      setLabel('')
      queryClient.invalidateQueries({ queryKey: ['assets', brandId] })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-base font-semibold">Add an asset</h2>
      <p className="text-sm text-neutral-500">
        Generated artifacts inject these real files. An AI-approximated logo is never
        acceptable output, and font files must live here or typography falls back silently.
      </p>
      <ErrorBanner error={upload.error} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="File">
          <input ref={fileRef} type="file" className="text-sm" />
        </Field>
        <Field label="Type">
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}
                  className="rounded border px-2 py-1 text-sm">
            {TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Label">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="Primary lockup" className="rounded border px-2 py-1 text-sm" />
        </Field>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending}>Upload</Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write the grid and the page**

```tsx
// frontend/components/brand/AssetGrid.tsx
'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Asset } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

export function AssetGrid({ brandId, readOnly }: { brandId: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const assets = useQuery({ queryKey: ['assets', brandId],
    queryFn: () => apiFetch<Asset[]>(`/brands/${brandId}/assets`) })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets', brandId] }),
  })

  if (assets.isLoading) return <Spinner />
  const fonts = (assets.data ?? []).filter((a) => a.asset_type === 'font')
  const files = (assets.data ?? []).filter((a) => a.asset_type !== 'font')

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Fonts</h2>
        {fonts.length === 0 ? (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            No brand fonts uploaded. Generation will fall back to whatever the
            container happens to have, and the font QA check will fail.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {fonts.map((font) => (
              <li key={font.id} className="flex items-center gap-2 rounded border px-3 py-1 text-sm">
                <span>{font.label}</span>
                {!readOnly && (
                  <button onClick={() => remove.mutate(font.id)}
                          aria-label={`Remove ${font.label}`}
                          className="text-xs text-neutral-500 hover:text-red-600">×</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Logos and images</h2>
        <ul className="grid grid-cols-4 gap-4">
          {files.map((asset) => (
            <li key={asset.id} className="flex flex-col gap-2 rounded border p-3">
              {asset.url && (
                <img src={asset.url} alt={asset.label}
                     className="h-24 w-full object-contain" />
              )}
              <span className="text-xs">{asset.label}</span>
              <span className="text-xs text-neutral-500">{asset.asset_type}</span>
              {!readOnly && (
                <Button variant="ghost" onClick={() => remove.mutate(asset.id)}>Remove</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

```tsx
// frontend/app/(app)/brands/[brandId]/assets/page.tsx
'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { AssetUploader } from '@/components/brand/AssetUploader'
import { AssetGrid } from '@/components/brand/AssetGrid'

export default function AssetsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const isAdmin = me.data?.role === 'admin'
  return (
    <div className="grid grid-cols-[180px_1fr] gap-8">
      <NavLinks brandId={brandId} />
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">Assets</h1>
        {isAdmin && <AssetUploader brandId={brandId} />}
        <AssetGrid brandId={brandId} readOnly={!isAdmin} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/assets.test.tsx`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/components/brand frontend/app/\(app\)/brands/\[brandId\]/assets frontend/tests/assets.test.tsx
git commit -m "feat: asset library with a visible warning when fonts are missing"
```

### Task 11: Admin — models and skills

**Files:**
- Create: `frontend/app/(app)/admin/models/page.tsx`
- Create: `frontend/app/(app)/admin/skills/page.tsx`
- Test: `frontend/tests/admin.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Provider`, `Skill`, `Me`.
- Produces: two routes; no exported components.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/admin.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ModelsPage from '@/app/(app)/admin/models/page'
import SkillsPage from '@/app/(app)/admin/skills/page'
import { renderWithQuery, mockApi } from './helpers'

const admin = { id: 'u', email: 'a@b', role: 'admin' as const }

describe('models admin', () => {
  it('never renders an api key back to the screen', async () => {
    mockApi({ '/me': admin, '/providers': [
      { id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }] })
    const { container } = renderWithQuery(<ModelsPage />)
    await waitFor(() => screen.getByText('claude'))
    expect(container.textContent).not.toMatch(/sk-/)
  })

  it('lets an admin disable a provider', async () => {
    mockApi({ '/me': admin, '/providers': [
      { id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }] })
    renderWithQuery(<ModelsPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument())
  })

  it('tells a member this page is admin-only', async () => {
    mockApi({ '/me': { ...admin, role: 'member' }, '/providers': [] })
    renderWithQuery(<ModelsPage />)
    await waitFor(() => expect(screen.getByText(/admin only/i)).toBeInTheDocument())
  })
})

describe('skills admin', () => {
  it('does not offer image as a scope', async () => {
    mockApi({ '/me': admin, '/skills': [] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => screen.getByText(/upload a skill/i))
    // PRD 6.4: image-mode has no coding agent, so no skill can target it.
    expect(screen.queryByLabelText('image')).toBeNull()
    expect(screen.getByLabelText('carousel')).toBeInTheDocument()
  })

  it('explains why image is absent', async () => {
    mockApi({ '/me': admin, '/skills': [] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() =>
      expect(screen.getByText(/no coding agent.*image/i)).toBeInTheDocument())
  })

  it('lists an uploaded skill with its scopes', async () => {
    mockApi({ '/me': admin, '/skills': [
      { id: 's1', name: 'hallmark', storage_ref: 'k',
        applies_to: ['single_pager'], enabled: true, created_at: '' }] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => expect(screen.getByText('hallmark')).toBeInTheDocument())
    expect(screen.getByText(/single_pager/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/admin.test.tsx`
Expected: FAIL — the page modules do not exist

- [ ] **Step 3: Write the models page**

```tsx
// frontend/app/(app)/admin/models/page.tsx
'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me, Provider, ProviderType } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [type, setType] = useState<ProviderType>('coding_agent')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const providers = useQuery({ queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers') })

  const create = useMutation({
    mutationFn: () => apiFetch<Provider>('/providers', {
      method: 'POST', body: JSON.stringify({ type, name, api_key: apiKey }) }),
    onSuccess: () => {
      setName(''); setApiKey('')
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })

  const toggle = useMutation({
    mutationFn: (provider: Provider) => apiFetch<Provider>(`/providers/${provider.id}`, {
      method: 'PATCH', body: JSON.stringify({ enabled: !provider.enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })

  if (me.isLoading) return <Spinner />
  if (me.data?.role !== 'admin') {
    return <p className="text-sm text-neutral-500">Models are admin only.</p>
  }

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Models</h1>
      <ErrorBanner error={create.error ?? toggle.error} />

      <div className="flex flex-wrap items-end gap-4 rounded border p-4">
        <Field label="Kind">
          <select value={type} onChange={(e) => setType(e.target.value as ProviderType)}
                  className="rounded border px-2 py-1 text-sm">
            <option value="coding_agent">coding agent</option>
            <option value="image_provider">image provider</option>
          </select>
        </Field>
        <Field label="Name" hint="As open-design expects it, e.g. claude, kimi, gpt-image-2.">
          <input value={name} onChange={(e) => setName(e.target.value)}
                 className="rounded border px-2 py-1 text-sm" />
        </Field>
        <Field label="API key" hint="Encrypted on save. Never shown again.">
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                 className="rounded border px-2 py-1 text-sm" />
        </Field>
        <Button onClick={() => create.mutate()}
                disabled={!name.trim() || !apiKey || create.isPending}>Add</Button>
      </div>

      <ul className="divide-y rounded border">
        {providers.data?.map((provider) => (
          <li key={provider.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              {provider.name}
              <span className="ml-2 text-xs text-neutral-500">{provider.type}</span>
            </span>
            <Button variant="ghost" onClick={() => toggle.mutate(provider)}>
              {provider.enabled ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Write the skills page**

```tsx
// frontend/app/(app)/admin/skills/page.tsx
'use client'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ArtifactType, Me, Skill } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

// PRD 6.4: `image` is deliberately absent. A skill works by instructing a
// coding agent, and image-mode has none. The backend refuses it too — this
// list is the affordance, not the enforcement.
const SCOPES: ArtifactType[] = ['social_post', 'carousel', 'deck', 'single_pager']

export default function SkillsPage() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ArtifactType[]>([])

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => apiFetch<Skill[]>('/skills') })

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a SKILL.md first')
      const body = new FormData()
      body.append('file', file)
      body.append('name', name)
      body.append('applies_to', scopes.join(','))
      return apiFetch<Skill>('/skills', { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      setName(''); setScopes([])
      queryClient.invalidateQueries({ queryKey: ['skills'] })
    },
  })

  const toggle = useMutation({
    mutationFn: (skill: Skill) => apiFetch<Skill>(`/skills/${skill.id}`, {
      method: 'PATCH', body: JSON.stringify({ enabled: !skill.enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  if (me.isLoading) return <Spinner />
  if (me.data?.role !== 'admin') {
    return <p className="text-sm text-neutral-500">Skills are admin only.</p>
  }

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Skills</h1>
      <ErrorBanner error={upload.error ?? toggle.error} />

      <div className="flex flex-col gap-3 rounded border p-4">
        <h2 className="text-base font-semibold">Upload a skill</h2>
        <p className="text-sm text-neutral-500">
          A SKILL.md is read by the coding agent while it generates. Images have
          no coding agent in the loop, so image is not an option here.
        </p>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)}
                 className="rounded border px-2 py-1 text-sm" />
        </Field>
        <Field label="SKILL.md">
          <input ref={fileRef} type="file" accept=".md" className="text-sm" />
        </Field>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="text-sm font-medium">Applies to</legend>
          {SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1 text-sm">
              <input type="checkbox" aria-label={scope} checked={scopes.includes(scope)}
                     onChange={(e) => setScopes(e.target.checked
                       ? [...scopes, scope] : scopes.filter((s) => s !== scope))} />
              {scope}
            </label>
          ))}
        </fieldset>
        <Button onClick={() => upload.mutate()}
                disabled={!name.trim() || scopes.length === 0 || upload.isPending}>
          Upload
        </Button>
      </div>

      <ul className="divide-y rounded border">
        {skills.data?.map((skill) => (
          <li key={skill.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              {skill.name}
              <span className="ml-2 text-xs text-neutral-500">{skill.applies_to.join(', ')}</span>
            </span>
            <Button variant="ghost" onClick={() => toggle.mutate(skill)}>
              {skill.enabled ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/admin.test.tsx`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/app/\(app\)/admin frontend/tests/admin.test.tsx
git commit -m "feat: admin pages for models and skills with image scope withheld"
```

### Task 12: End-to-end walkthrough

**Files:**
- Create: `frontend/tests/e2e/full-loop.spec.ts`
- Create: `frontend/playwright.config.ts`

**Interfaces:**
- Consumes: a running backend and open-design instance.
- Produces: one Playwright spec covering brief → copy → approve → generate → QA → approve → export.

- [ ] **Step 1: Write the spec**

```typescript
// frontend/tests/e2e/full-loop.spec.ts
import { test, expect } from '@playwright/test'

// Requires: docker compose up, a seeded admin user, and one enabled coding agent.
test('a member takes a brief all the way to an export', async ({ page }) => {
  await page.goto('/brands')
  await page.getByRole('link', { name: 'Ladder' }).click()

  await page.getByRole('link', { name: 'Briefs' }).click()
  await page.getByRole('link', { name: 'New brief' }).click()
  await page.getByLabel('Brief').fill('Announce the pricing change to existing customers.')
  await page.getByRole('button', { name: 'Save brief' }).click()

  // Copy stage — hand-written path.
  await page.getByLabel('Copy').fill('Prices change on 1 March. Here is what moves and why.')
  await page.getByRole('button', { name: 'Save copy' }).click()
  await page.getByRole('button', { name: 'Approve copy' }).click()

  // Design unlocks only after approval.
  await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
  await page.getByLabel('Artifact').selectOption('carousel')
  await page.getByLabel('Model').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Generate' }).click()

  // Progress is reconnectable: reload mid-generation and it recovers.
  await expect(page.getByRole('progressbar')).toBeVisible()
  await page.reload()
  await page.getByRole('link', { name: 'Open artifact' }).click()

  await expect(page.getByText(/Quality checks/)).toBeVisible({ timeout: 300_000 })
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()

  await expect(page.getByRole('link', { name: /Download PNG/i })).toBeVisible()
})

test('design stays locked while the copy is a draft', async ({ page }) => {
  await page.goto('/brands')
  await page.getByRole('link', { name: 'Ladder' }).click()
  await page.getByRole('link', { name: 'Briefs' }).click()
  await page.getByRole('link', { name: 'New brief' }).click()
  await page.getByLabel('Brief').fill('Draft only.')
  await page.getByRole('button', { name: 'Save brief' }).click()
  await page.getByLabel('Copy').fill('Unapproved words.')
  await page.getByRole('button', { name: 'Save copy' }).click()

  await expect(page.getByText('Design unlocks once the copy is approved.')).toBeVisible()
})
```

- [ ] **Step 2: Write the Playwright config**

```typescript
// frontend/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] **Step 3: Run it against the real stack**

```bash
cd ../backend && docker compose up -d && cd ../frontend
npx playwright test tests/e2e/full-loop.spec.ts
```

Expected: both tests pass. If the first hangs at "Quality checks", the QA gate or open-design is the problem, not the frontend — check the worker logs.

- [ ] **Step 4: Run every test**

Run: `npx vitest run && npx playwright test`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/e2e frontend/playwright.config.ts
git commit -m "test: end-to-end walkthrough from brief to export"
```

---

## Self-Review

**Spec coverage.**

| PRD | Task |
|---|---|
| §2 in-scope artifact types | 7 (`TYPES`), 8 (export panel) |
| §2 no publishing/scheduling UI | Global Constraints — no such route exists |
| §2 no design-system wizard | 4 — plain markdown editors only |
| §2 no per-brand permission UI | 3 — brand list is flat, no access controls |
| §3 admin vs member | 4, 6, 9, 10, 11 — every admin affordance is role-gated |
| §4.1 DESIGN.md | 4 |
| §4.2 VOICE.md | 4, 6 (generation refused without it) |
| §4.3 references, scope/role, PPTX parsed, expectation-setting | 9 |
| §4.4 assets, fonts P0 | 10 |
| §5.1 brief, research pre-fill with review step | 5 |
| §5.2 copy stage, hand-written first-class, approval gate | 6 |
| §5.3 model choice, variants | 7 |
| §5.4 iteration, no canvas | 8 |
| §5.5 QA gate visible | 8 |
| §5.6 approval | 8 |
| §5.7 export | 8 |
| §6.2 findings shown per check and per page | 8 |
| §6.4 `image` withheld from skill scopes | 11 |
| §7.1 reconnectable progress | 7, 12 (reload mid-generation) |
| §12 brand contracts come first | 3 — the overview blocks on missing contracts |

**Deliberate omissions.** No fixture-matrix UI: PRD §11 puts it in Phase 3 as a dev command, and Task 24 of the backend plan ships it as CLI. No cost dashboard (PRD §10.7). No user-management page — Supabase upserts members on first sign-in, and admin promotion is a database update until there is a reason for a screen.

**Placeholder scan.** No TODOs. Every component named in the File Structure is written in a task, except `NavLinks`/`AppShell` variants already covered in Task 3.

**Type consistency.** `Artifact`, `Copy`, `Brief`, `Provider`, `Skill`, `QaReport` and `JobSnapshot` are defined once in `lib/types.ts` and match the backend Pydantic schemas field for field. `apiFetch` has one signature across all tasks. `readOnly` is the prop name for role gating in every brand component. `onApproved` and `onRerun` are the only callback props and each appears in exactly one component.

---

## Execution Handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session with checkpoints. Use `superpowers:executing-plans`.

**Frontend Task 1 can start as soon as backend Task 3 lands** (auth) — everything before that has no API to call. Tasks 6 onward need backend Phase 1 complete.
