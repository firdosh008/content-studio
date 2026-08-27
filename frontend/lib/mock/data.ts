// Dev-only in-memory dataset for NEXT_PUBLIC_API_MOCK=true. Mirrors lib/types.ts
// exactly. State is snapshotted to sessionStorage after every mutating request
// so a browser reload (same tab) resumes where it left off — including running
// jobs, whose progress derives from persisted start timestamps.
import type {
  Artifact,
  Asset,
  Brand,
  Brief,
  Contract,
  Copy,
  JobSnapshot,
  Provider,
  Reference,
  Skill,
} from '@/lib/types'

export const MOCK_LATENCY_MS = 180
export const MOCK_JOB_DURATION_MS = 20_000
export const MOCK_STATE_KEY = 'cs-mock-db'

export type MockDb = {
  counter: number
  role: 'admin' | 'member'
  brands: Brand[]
  contracts: Record<string, Contract>
  providers: Provider[]
  skills: Skill[]
  references: Reference[]
  assets: Asset[]
  briefs: Brief[]
  copies: Copy[]
  artifacts: Artifact[]
  // Job start times for artifacts that are still generating (progress derives from wall clock).
  jobStarted: Record<string, number>
  jobAttempts: Record<string, number>
}

export const now = () => new Date().toISOString()
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

// Placeholder page raster as an SVG data URI so the viewer works offline.
export function pageImage(title: string, subtitle: string, index: number, total: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#0E0B09"/>
  <circle cx="900" cy="180" r="260" fill="#E8543A" fill-opacity="0.18"/>
  <text x="80" y="140" font-family="monospace" font-size="26" letter-spacing="6" fill="#A89F97">LADDER · ${index} / ${total}</text>
  <text x="80" y="520" font-family="Georgia, serif" font-size="110" fill="#F2EDE4">${title}</text>
  <text x="80" y="640" font-family="Georgia, serif" font-style="italic" font-size="110" fill="#E8543A">${subtitle}</text>
  <text x="80" y="960" font-family="sans-serif" font-size="30" fill="#A89F97">Mock render — replace with open-design output</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const pages = (n: number, title: string, subtitle: string) =>
  Array.from({ length: n }, (_, i) => pageImage(title, subtitle, i + 1, n))

export const DESIGN_MD = `# Ladder — DESIGN.md

## Palette
- Background: #0E0B09
- Surface: #171310
- Text: #F2EDE4
- Accent: #E8543A

## Type
- Display: Instrument Serif, 96/104
- Body: Inter, 18/28
- Micro: JetBrains Mono, 12, uppercase, tracking 0.2em

## Layout
- 1080×1080 social, 12-col grid, 80px margins
- One idea per card. Headline never exceeds two lines.
`

export const VOICE_MD = `# Ladder — VOICE.md

## Sounds like
Direct, warm, operator-to-operator. Short sentences. Verbs first.

## Never
- "Unlock", "supercharge", "game-changing", "seamless"
- Em-dash chains, rhetorical questions in a row
- Claims without a number we can source

## Claims
Every number cites the pilot data sheet.
`

export const PASSING_QA = {
  passed: true,
  findings: [],
  checks_run: ['structure', 'overflow', 'bounds', 'tokens', 'fill', 'palette', 'fonts'],
  skipped: ['determinism'],
}
export const FAILING_QA = {
  passed: false,
  findings: [
    { check: 'overflow', severity: 'error' as const, page: 1, detail: '<h1> content 812x40 exceeds box 400x40: "What stays the same and what moves"' },
    { check: 'fill', severity: 'error' as const, page: 3, detail: 'page 3 is 12% filled, below the 35% threshold — dead space' },
    { check: 'palette', severity: 'warning' as const, page: null, detail: '#FF5A36 is not in DESIGN.md; nearest brand colour is #E8543A' },
  ],
  checks_run: ['structure', 'overflow', 'bounds', 'tokens', 'fill', 'palette', 'fonts'],
  skipped: ['determinism'],
}

const base = (id: string, patch: Partial<Artifact>): Artifact => ({
  id,
  brand_id: 'b_ladder',
  brief_id: 'br_pricing',
  copy_id: 'c_pricing',
  artifact_type: 'carousel',
  generation_mode: 'code',
  model_provider_id: 'p_claude',
  status: 'ready',
  version: 1,
  parent_artifact_id: null,
  variant_group_id: null,
  open_design_project_ref: `proj_${id}`,
  export_urls: {},
  qa_report: PASSING_QA,
  created_at: ago(60 * 20),
  ...patch,
})

export function seed(): MockDb {
  return {
    counter: 100,
    role: 'admin',
    brands: [
      { id: 'b_ladder', name: 'Ladder', slug: 'ladder', created_at: ago(60 * 24 * 12) },
      { id: 'b_loopr', name: 'Agent Loopr', slug: 'agent-loopr', created_at: ago(60 * 24 * 2) },
    ],
    contracts: {
      'b_ladder:design': { content: DESIGN_MD, version: 3, updated_at: ago(60 * 5) },
      'b_ladder:voice': { content: VOICE_MD, version: 2, updated_at: ago(60 * 30) },
      'b_loopr:design': { content: '', version: 0, updated_at: null },
      'b_loopr:voice': { content: '', version: 0, updated_at: null },
    },
    providers: [
      { id: 'p_claude', type: 'coding_agent', name: 'claude', enabled: true, created_at: ago(60 * 24 * 10) },
      { id: 'p_kimi', type: 'coding_agent', name: 'kimi', enabled: false, created_at: ago(60 * 24 * 9) },
      { id: 'p_gpt_image', type: 'image_provider', name: 'gpt-image-2', enabled: true, created_at: ago(60 * 24 * 8) },
    ],
    skills: [
      { id: 's_hallmark', name: 'hallmark', storage_ref: 'skills/hallmark/SKILL.md', applies_to: ['single_pager', 'deck'], enabled: true, created_at: ago(60 * 24 * 7) },
    ],
    references: [
      { id: 'r1', brand_id: 'b_ladder', file_ref: 'refs/hero.png', file_type: 'image', scope: 'social', role: 'layout', extracted_layout_spec: null, url: pageImage('Videos that', 'ladder up.', 1, 1), created_at: ago(60 * 24 * 3) },
      { id: 'r2', brand_id: 'b_ladder', file_ref: 'refs/pitch.pptx', file_type: 'pptx', scope: 'presentation', role: 'layout', extracted_layout_spec: 'slide_size: 13.33x7.50in\nplaceholders: title, body, footer', url: null, created_at: ago(60 * 24 * 3) },
      { id: 'r3', brand_id: 'b_ladder', file_ref: 'refs/gradient.png', file_type: 'image', scope: 'both', role: 'colour_gradient', extracted_layout_spec: null, url: pageImage('Warm', 'gradient.', 1, 1), created_at: ago(60 * 24 * 1) },
    ],
    assets: [
      { id: 'as1', brand_id: 'b_ladder', asset_type: 'logo', file_ref: 'assets/logo.svg', label: 'Primary lockup', url: pageImage('▲', 'Ladder', 1, 1), created_at: ago(60 * 24 * 11) },
      { id: 'as2', brand_id: 'b_ladder', asset_type: 'font', file_ref: 'assets/Inter.ttf', label: 'Inter', url: null, created_at: ago(60 * 24 * 11) },
      { id: 'as3', brand_id: 'b_ladder', asset_type: 'font', file_ref: 'assets/InstrumentSerif.ttf', label: 'Instrument Serif', url: null, created_at: ago(60 * 24 * 11) },
      { id: 'as4', brand_id: 'b_ladder', asset_type: 'headshot', file_ref: 'assets/founder.jpg', label: 'Founder headshot', url: pageImage('Founder', 'headshot', 1, 1), created_at: ago(60 * 24 * 4) },
    ],
    briefs: [
      { id: 'br_pricing', brand_id: 'b_ladder', content: 'Announce the March pricing change to existing customers. Lead with what stays the same, then what moves and why. Tone: candid, no spin.', source: 'manual', research_run_id: null, created_at: ago(60 * 26) },
      { id: 'br_pilot', brand_id: 'b_ladder', content: 'Share the pilot results: 9 of 12 founders shipped a video in week one; average idea-to-scene time 11m 42s. Position the pilot as proof, not a promise.', source: 'research_agent', research_run_id: 'run_7f3a', created_at: ago(60 * 5) },
      { id: 'br_launch', brand_id: 'b_ladder', content: 'Launch teaser for the studio session feature.', source: 'manual', research_run_id: null, created_at: ago(40) },
    ],
    copies: [
      { id: 'c_pricing', brief_id: 'br_pricing', brand_id: 'b_ladder', content: 'Prices change on 1 March.\n\nWhat stays: every plan keeps unlimited sessions.\nWhat moves: the Team plan goes from $79 to $89.\nWhy: transcript storage tripled since launch and we would rather charge for it than cap it.\n\nQuestions? Reply to this post. A human answers.', status: 'approved', version: 2, generated_by_model_id: null, approved_by: 'u_admin', created_at: ago(60 * 25) },
      { id: 'c_pilot', brief_id: 'br_pilot', brand_id: 'b_ladder', content: '9 of 12 founders shipped a video in week one.\n\nIdea to scene: 11 minutes 42 seconds on average.\n\nThat is the pilot. The product is what happens next.', status: 'draft', version: 1, generated_by_model_id: 'p_claude', approved_by: null, created_at: ago(60 * 4) },
    ],
    artifacts: [
      base('a_ready', { pages: pages(4, 'Prices change', 'on 1 March.'), export_urls: { png: pageImage('Prices change', 'on 1 March.', 1, 4) }, created_at: ago(60 * 20) }),
      base('a_qafail', { status: 'qa_failed', qa_report: FAILING_QA, pages: pages(3, 'What stays,', 'what moves.'), variant_group_id: 'vg_pricing', created_at: ago(60 * 18) }),
      base('a_review', { status: 'in_review', pages: pages(4, 'Same plans,', 'new price.'), variant_group_id: 'vg_pricing', created_at: ago(60 * 17) }),
      base('a_v1', { artifact_type: 'deck', status: 'approved', pages: pages(6, 'Pilot', 'results.'), brief_id: 'br_pilot', copy_id: 'c_pilot', created_at: ago(60 * 10) }),
      base('a_v2', { artifact_type: 'deck', status: 'ready', version: 2, parent_artifact_id: 'a_v1', pages: pages(6, 'Pilot results,', 'bigger headline.'), brief_id: 'br_pilot', copy_id: 'c_pilot', created_at: ago(60 * 9) }),
      base('a_failed', { artifact_type: 'social_post', status: 'failed', qa_report: {}, pages: [], created_at: ago(60 * 8) }),
      base('a_image', { artifact_type: 'image', generation_mode: 'image', model_provider_id: 'p_gpt_image', status: 'ready', qa_report: { passed: true, findings: [], checks_run: ['structure'], skipped: ['overflow', 'bounds', 'tokens', 'fill', 'palette', 'fonts', 'determinism'] }, export_urls: { png: pageImage('One image,', 'one idea.', 1, 1) }, created_at: ago(60 * 3) }),
      base('a_live', { status: 'generating', qa_report: {}, pages: [], variant_group_id: 'vg_live', created_at: ago(0.2) }),
      base('a_live2', { status: 'queued', qa_report: {}, pages: [], variant_group_id: 'vg_live', created_at: ago(0.2) }),
    ],
    jobStarted: { a_live: Date.now() - 4_000, a_live2: Date.now() + 6_000 },
    jobAttempts: { a_live: 2 },
  }
}

export const db: MockDb = seed()

export const nextId = (prefix: string) => `${prefix}_${++db.counter}`

// ---- persistence (sessionStorage; dev only; never tokens or secrets)

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

let hydrated = false

/** Load a persisted snapshot if one exists. Returns true when state was restored. */
export function loadMockState(): boolean {
  const store = storage()
  if (!store) return false
  try {
    const raw = store.getItem(MOCK_STATE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as Partial<MockDb>
    if (!parsed || !Array.isArray(parsed.brands)) return false
    replaceDb({ ...seed(), ...parsed })
    return true
  } catch {
    return false
  }
}

export function saveMockState() {
  const store = storage()
  if (!store) return
  try {
    store.setItem(MOCK_STATE_KEY, JSON.stringify(db))
  } catch {}
}

/** First-request hydration: seed only when no persisted snapshot exists. */
export function ensureHydrated() {
  if (hydrated) return
  hydrated = true
  loadMockState()
}

/** Explicit reset for tests and the dev banner: clears the snapshot and re-seeds. */
export function resetMockState() {
  storage()?.removeItem(MOCK_STATE_KEY)
  replaceDb(seed())
  hydrated = true
}

/** Test helper: forget the in-memory state so the next request re-reads storage (simulates a reload). */
export function forgetMockStateForTests() {
  hydrated = false
  replaceDb(seed())
}

function replaceDb(next: MockDb) {
  for (const key of Object.keys(db) as (keyof MockDb)[]) delete (db as Record<string, unknown>)[key]
  Object.assign(db, next)
}

export function jobFor(artifact: Artifact): JobSnapshot {
  const attempts = db.jobAttempts[artifact.id] ?? 1
  if (artifact.status === 'failed') {
    return { job_id: `job_${artifact.id}`, state: 'failed', attempts: 3, progress: { stage: 'generating', percent: 40 }, error: 'open-design unreachable after 3 attempts' }
  }
  if (!['queued', 'generating'].includes(artifact.status)) {
    return { job_id: `job_${artifact.id}`, state: 'succeeded', attempts, progress: { stage: 'done', percent: 100 }, error: null }
  }
  const started = db.jobStarted[artifact.id] ?? Date.now()
  const elapsed = Date.now() - started
  if (elapsed < 0) {
    return { job_id: `job_${artifact.id}`, state: 'queued', attempts: 0, progress: { stage: 'queued', percent: 0 }, error: null }
  }
  const percent = Math.min(99, Math.round((elapsed / MOCK_JOB_DURATION_MS) * 100))
  const stage = percent < 15 ? 'syncing_brand' : percent < 80 ? 'generating' : 'qa'
  const detail = stage === 'generating' ? `${Math.round(percent * 84)} tok · $${(percent * 0.0047).toFixed(2)}` : undefined
  return { job_id: `job_${artifact.id}`, state: 'running', attempts, progress: { stage, percent, detail }, error: null }
}

// Advance any live artifact whose mock job has finished.
export function settleJobs() {
  for (const artifact of db.artifacts) {
    if (!['queued', 'generating'].includes(artifact.status)) continue
    const started = db.jobStarted[artifact.id] ?? Date.now()
    const elapsed = Date.now() - started
    if (elapsed >= 0 && artifact.status === 'queued') artifact.status = 'generating'
    if (elapsed >= MOCK_JOB_DURATION_MS) {
      const n = artifact.artifact_type === 'deck' ? 6 : artifact.artifact_type === 'carousel' ? 4 : 1
      const brief = db.briefs.find((b) => b.id === artifact.brief_id)
      const words = (brief?.content ?? 'New artifact').split(' ')
      artifact.pages = pages(n, words.slice(0, 2).join(' '), words.slice(2, 4).join(' ') + '.')
      artifact.export_urls = { png: artifact.pages[0] }
      const fails = artifact.id.endsWith('7') // deterministic sprinkle of QA failures
      artifact.qa_report = artifact.generation_mode === 'image' ? { passed: true, findings: [], checks_run: ['structure'], skipped: [] } : fails ? FAILING_QA : PASSING_QA
      artifact.status = fails ? 'qa_failed' : 'ready'
    }
  }
}
