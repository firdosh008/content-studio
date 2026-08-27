// Dev-only mock backend for NEXT_PUBLIC_API_MOCK=true. Routes mirror
// ../backend/PLAN.md; error `detail` strings mirror what the real API says so
// the verbatim-error UI can be seen. Everything is served from lib/mock/data.ts
// and snapshotted to sessionStorage after each mutating request.
import type { Artifact, ArtifactType, Copy, JobSnapshot, Provider, Skill } from '@/lib/types'
import { getMockRole } from './index'
import {
  db,
  ensureHydrated,
  jobFor,
  MOCK_LATENCY_MS,
  nextId,
  now,
  pageImage,
  saveMockState,
  settleJobs,
} from './data'

type Reply = { status: number; body?: unknown }
type Ctx = { fileUrl?: string }
const ok = (body: unknown): Reply => ({ status: 200, body })
const err = (status: number, detail: string): Reply => ({ status, body: { detail } })
const NO_CONTENT: Reply = { status: 204 }

const FONT_EXT = ['.otf', '.ttf', '.woff', '.woff2']
const LIVE = ['queued', 'generating']

// Tiny valid fixture files served from /public so every format is a real,
// distinct download. Which formats an artifact type gets is the (mock)
// backend's rule — the frontend only renders what comes back.
const FIXTURE_BASE = '/mock-downloads/sample'
const EXPORT_FORMATS: Record<ArtifactType, string[]> = {
  social_post: ['png'],
  carousel: ['png', 'zip'],
  deck: ['pptx', 'pdf'],
  single_pager: ['pdf', 'html'],
  image: ['png', 'jpg'],
}

function admin(): Reply | null {
  return db.role === 'admin' ? null : err(403, 'admin only')
}

function parseJson(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== 'string') return {}
  try {
    return JSON.parse(init.body) as Record<string, unknown>
  } catch {
    return {}
  }
}

function form(init?: RequestInit): { file?: File; get: (k: string) => string } {
  const body = init?.body
  if (body instanceof FormData) {
    const file = body.get('file')
    return { file: file instanceof File ? file : undefined, get: (k) => String(body.get(k) ?? '') }
  }
  return { get: () => '' }
}

// ---- artifact branches: variants are sibling roots; iterations are versions inside one branch.
function rootOf(a: Artifact): Artifact {
  let cur = a
  const seen = new Set<string>()
  while (cur.parent_artifact_id && !seen.has(cur.id)) {
    seen.add(cur.id)
    const parent = db.artifacts.find((x) => x.id === cur.parent_artifact_id)
    if (!parent) break
    cur = parent
  }
  return cur
}

function latestInBranch(root: Artifact): Artifact {
  let cur = root
  for (;;) {
    const kids = db.artifacts.filter((x) => x.parent_artifact_id === cur.id)
    if (kids.length === 0) return cur
    cur = kids.reduce((best, x) => (x.version > best.version ? x : best))
  }
}

function branchLineage(a: Artifact): Artifact[] {
  const chain: Artifact[] = []
  let cur: Artifact | undefined = a
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = db.artifacts.find((x) => x.id === cur!.parent_artifact_id)
  }
  // then the newest descendants below the selected version
  let tail = a
  for (;;) {
    const kids = db.artifacts.filter((x) => x.parent_artifact_id === tail.id)
    if (kids.length === 0) break
    tail = kids.reduce((best, x) => (x.version > best.version ? x : best))
    chain.push(tail)
  }
  return chain
}

function artifact(id: string) {
  settleJobs()
  return db.artifacts.find((a) => a.id === id)
}

function withActions(a: Artifact): Artifact {
  const actions: Artifact['allowed_actions'] =
    a.status === 'ready' ? ['submit', 'qa', 'iterate']
    : a.status === 'in_review' ? ['approve', 'reject', 'iterate']
    : a.status === 'approved' || a.status === 'qa_failed' ? ['qa', 'iterate']
    : []
  return { ...a, allowed_actions: actions }
}

function exportsFor(a: Artifact): Record<string, string> {
  const out: Record<string, string> = {}
  for (const format of EXPORT_FORMATS[a.artifact_type]) {
    out[format] = `${FIXTURE_BASE}.${format}?artifact=${encodeURIComponent(a.id)}&v=${a.version}`
  }
  return out
}

// Synthetic running snapshot for the SSE scenario harness (/dev/sse); these ids never exist as artifacts.
function sseScenarioJob(id: string): JobSnapshot {
  return { job_id: `job_${id}`, state: 'running', attempts: 1, progress: { stage: 'syncing_brand', percent: 0 }, error: null }
}

function route(method: string, path: string, query: URLSearchParams, init: RequestInit | undefined, ctx: Ctx): Reply {
  const seg = path.split('/').filter(Boolean)
  const [root, id, sub] = seg

  // ---- identity
  if (path === '/me') return ok({ id: `u_${db.role}`, email: `${db.role}@ladder.dev`, role: db.role })

  // ---- brands + contracts
  if (root === 'brands' && !id) {
    if (method === 'GET') return ok(db.brands)
    if (method === 'POST') {
      const gate = admin(); if (gate) return gate
      const { name } = parseJson(init)
      if (typeof name !== 'string' || !name.trim()) return err(422, 'name must not be empty')
      const brand = { id: nextId('b'), name: name.trim(), slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), created_at: now() }
      db.brands.push(brand)
      db.contracts[`${brand.id}:design`] = { content: '', version: 0, updated_at: null }
      db.contracts[`${brand.id}:voice`] = { content: '', version: 0, updated_at: null }
      return ok(brand)
    }
  }
  if (root === 'brands' && id) {
    const brand = db.brands.find((b) => b.id === id)
    if (!brand) return err(404, 'brand not found')
    if (!sub) return ok(brand)
    if (sub === 'design' || sub === 'voice') {
      const key = `${id}:${sub}`
      if (method === 'GET') return ok(db.contracts[key])
      if (method === 'PUT') {
        const gate = admin(); if (gate) return gate
        const { content } = parseJson(init)
        const current = db.contracts[key]
        db.contracts[key] = { content: String(content ?? ''), version: current.version + 1, updated_at: now() }
        return ok(db.contracts[key])
      }
    }
    if (sub === 'references') {
      if (method === 'GET') return ok(db.references.filter((r) => r.brand_id === id))
      if (method === 'POST') {
        const gate = admin(); if (gate) return gate
        const f = form(init)
        if (!f.file) return err(422, 'file is required')
        const isPptx = f.file.name.toLowerCase().endsWith('.pptx')
        if (isPptx && f.file.size < 64) return err(422, 'unreadable pptx: File is not a zip file')
        const ref = {
          id: nextId('r'), brand_id: id, file_ref: `refs/${f.file.name}`, file_type: (isPptx ? 'pptx' : 'image') as 'pptx' | 'image',
          scope: (f.get('scope') || 'social') as 'social', role: (f.get('role') || 'layout') as 'layout',
          extracted_layout_spec: isPptx ? 'slide_size: 13.33x7.50in\nplaceholders: title, body' : null,
          url: isPptx ? null : ctx.fileUrl ?? pageImage('Reference', f.file.name, 1, 1), created_at: now(),
        }
        db.references.push(ref)
        return ok(ref)
      }
    }
    if (sub === 'assets') {
      if (method === 'GET') return ok(db.assets.filter((a) => a.brand_id === id))
      if (method === 'POST') {
        const gate = admin(); if (gate) return gate
        const f = form(init)
        if (!f.file) return err(422, 'file is required')
        const type = (f.get('asset_type') || 'logo') as 'logo' | 'font'
        if (type === 'font' && !FONT_EXT.some((e) => f.file!.name.toLowerCase().endsWith(e))) {
          return err(422, `font file must be one of ['.otf', '.ttf', '.woff', '.woff2']`)
        }
        const asset = { id: nextId('as'), brand_id: id, asset_type: type, file_ref: `assets/${f.file.name}`, label: f.get('label') || f.file.name, url: type === 'font' ? null : ctx.fileUrl ?? pageImage('Asset', f.file.name, 1, 1), created_at: now() }
        db.assets.push(asset)
        return ok(asset)
      }
    }
  }
  if (root === 'references' && method === 'DELETE') {
    const gate = admin(); if (gate) return gate
    db.references = db.references.filter((r) => r.id !== id)
    return NO_CONTENT
  }
  if (root === 'assets' && method === 'DELETE') {
    const gate = admin(); if (gate) return gate
    db.assets = db.assets.filter((a) => a.id !== id)
    return NO_CONTENT
  }

  // ---- briefs + copy
  if (root === 'briefs' && !id) {
    if (method === 'GET') {
      const brandId = query.get('brand_id')
      return ok(db.briefs.filter((b) => !brandId || b.brand_id === brandId).sort((a, b) => b.created_at.localeCompare(a.created_at)))
    }
    if (method === 'POST') {
      const b = parseJson(init)
      if (typeof b.content !== 'string' || !b.content.trim()) return err(422, 'brief content must not be empty')
      const brief = { id: nextId('br'), brand_id: String(b.brand_id), content: b.content, source: (b.research_run_id ? 'research_agent' : 'manual') as 'manual', research_run_id: (b.research_run_id as string | null) ?? null, created_at: now() }
      db.briefs.push(brief)
      return ok(brief)
    }
  }
  if (root === 'briefs' && id === 'from-research' && method === 'POST') {
    const { brand_id, query: q } = parseJson(init)
    if (brand_id !== 'b_ladder') return err(503, 'no research agent configured; briefs are manual-only')
    return ok({ content: `Thesis for "${String(q)}": founders who ship a video in week one retain at 2.3× the baseline. Lead with the 9-of-12 pilot number; close with the 11m 42s idea-to-scene time.`, research_run_id: nextId('run') })
  }
  if (root === 'briefs' && id) {
    const brief = db.briefs.find((b) => b.id === id)
    if (!brief) return err(404, 'brief not found')
    if (!sub) return ok(brief)
    if (sub === 'copy') {
      const existing = db.copies.find((c) => c.brief_id === id)
      if (method === 'GET') return existing ? ok(existing) : err(404, 'no copy for this brief yet')
      if (method === 'POST') {
        const b = parseJson(init)
        let content: string
        let model: string | null = null
        if (b.generate) {
          const voice = db.contracts[`${brief.brand_id}:voice`]
          if (!voice || voice.version === 0) return err(422, 'brand has no VOICE.md; author it before generating copy')
          const provider = db.providers.find((p) => p.id === b.model_provider_id && p.enabled && p.type === 'coding_agent')
          if (!provider) return err(422, 'model_provider_id must be an enabled coding agent')
          model = provider.id
          content = `${brief.content.split('.')[0]}.\n\nHere is what changes, in one breath: the thing you asked for, said the way ${db.brands.find((x) => x.id === brief.brand_id)?.name} says things.\n\nNo unlocking. No supercharging. Just the number: 9 of 12.`
        } else {
          content = String(b.content ?? '')
          if (!content.trim()) return err(422, 'copy content must not be empty')
        }
        const copy: Copy = { id: nextId('c'), brief_id: id, brand_id: brief.brand_id, content, status: 'draft', version: existing ? existing.version + 1 : 1, generated_by_model_id: model, approved_by: null, created_at: now() }
        db.copies = db.copies.filter((c) => c.brief_id !== id).concat(copy)
        return ok(copy)
      }
    }
  }
  if (root === 'copy' && id) {
    const copy = db.copies.find((c) => c.id === id)
    if (!copy) return err(404, 'copy not found')
    if (method === 'PATCH') {
      const { content } = parseJson(init)
      Object.assign(copy, { content: String(content ?? copy.content), status: 'draft', approved_by: null, version: copy.version + 1 })
      return ok(copy)
    }
    if (sub === 'approve' && method === 'POST') {
      const gate = admin(); if (gate) return gate
      Object.assign(copy, { status: 'approved', approved_by: 'u_admin' })
      return ok(copy)
    }
  }

  // ---- providers + skills
  if (root === 'providers') {
    if (!id && method === 'GET') return ok(db.providers)
    if (!id && method === 'POST') {
      const gate = admin(); if (gate) return gate
      const b = parseJson(init)
      if (!b.api_key) return err(422, 'api_key is required')
      const provider: Provider = { id: nextId('p'), type: b.type as Provider['type'], name: String(b.name), enabled: true, created_at: now() }
      db.providers.push(provider)
      return ok(provider) // never echoes the key
    }
    if (id && method === 'PATCH') {
      const gate = admin(); if (gate) return gate
      const p = db.providers.find((x) => x.id === id)
      if (!p) return err(404, 'provider not found')
      const { enabled } = parseJson(init)
      p.enabled = Boolean(enabled)
      return ok(p)
    }
  }
  if (root === 'skills') {
    if (!id && method === 'GET') return ok(db.skills)
    if (!id && method === 'POST') {
      const gate = admin(); if (gate) return gate
      const f = form(init)
      const scopes = f.get('applies_to').split(',').filter(Boolean) as ArtifactType[]
      if (scopes.includes('image')) return err(422, 'skills cannot apply to image: image-mode has no coding agent')
      if (!f.file) return err(422, 'SKILL.md file is required')
      const skill: Skill = { id: nextId('s'), name: f.get('name') || f.file.name, storage_ref: `skills/${f.file.name}`, applies_to: scopes, enabled: true, created_at: now() }
      db.skills.push(skill)
      return ok(skill)
    }
    if (id && method === 'PATCH') {
      const gate = admin(); if (gate) return gate
      const s = db.skills.find((x) => x.id === id)
      if (!s) return err(404, 'skill not found')
      s.enabled = Boolean(parseJson(init).enabled)
      return ok(s)
    }
  }

  // ---- artifacts
  if (root === 'artifacts' && !id) {
    if (method === 'GET') {
      settleJobs()
      const brandId = query.get('brand_id')
      return ok(db.artifacts.filter((a) => !brandId || a.brand_id === brandId).map(withActions))
    }
    if (method === 'POST') {
      const b = parseJson(init)
      const copy = db.copies.find((c) => c.id === b.copy_id)
      if (!copy || copy.status !== 'approved') return err(409, 'copy must be approved before design can start')
      const type = b.artifact_type as ArtifactType
      const provider = db.providers.find((p) => p.id === b.model_provider_id && p.enabled)
      if (!provider) return err(422, 'model_provider_id must be an enabled provider')
      const mode = type === 'image' ? 'image' : 'code'
      if ((mode === 'image') !== (provider.type === 'image_provider')) return err(422, `${type} needs a ${mode === 'image' ? 'image_provider' : 'coding_agent'}`)
      const variants = Math.max(1, Math.min(8, Number(b.variants) || 1))
      const group = variants > 1 ? nextId('vg') : null
      const created: Artifact[] = []
      for (let i = 0; i < variants; i++) {
        const a: Artifact = { id: nextId('a'), brand_id: String(b.brand_id), brief_id: String(b.brief_id), copy_id: copy.id, artifact_type: type, generation_mode: mode, model_provider_id: provider.id, status: 'queued', version: 1, parent_artifact_id: null, variant_group_id: group, open_design_project_ref: null, export_urls: {}, qa_report: {}, created_at: now(), pages: [] }
        db.artifacts.push(a)
        db.jobStarted[a.id] = Date.now() + i * 2500
        created.push(a)
      }
      return ok(created)
    }
  }
  if (root === 'artifacts' && id) {
    if (id.startsWith('sse_') && sub === 'job') return ok(sseScenarioJob(id))
    const a = artifact(id)
    if (!a) return err(404, 'artifact not found')
    if (!sub) return ok(withActions(a))
    if (sub === 'job') return ok(jobFor(a))
    if (sub === 'lineage') return ok(branchLineage(a))
    if (sub === 'variants') {
      const rootA = rootOf(a)
      if (!rootA.variant_group_id) return ok([latestInBranch(rootA)])
      const roots = db.artifacts
        .filter((x) => x.variant_group_id === rootA.variant_group_id && x.parent_artifact_id === null)
        .sort((x, y) => x.created_at.localeCompare(y.created_at))
      return ok(roots.map(latestInBranch))
    }
    if (sub === 'exports') {
      if (!['ready', 'in_review', 'approved'].includes(a.status)) return err(409, `no exports while ${a.status}`)
      return ok(exportsFor(a))
    }
    if (method === 'POST') {
      if (sub === 'qa') {
        if (LIVE.includes(a.status) || a.status === 'failed') return err(409, `cannot run checks while ${a.status}`)
        return ok(withActions(a))
      }
      if (sub === 'submit') {
        if (a.status !== 'ready') return err(409, `cannot submit an artifact that is ${a.status}; it must be ready`)
        a.status = 'in_review'; return ok(withActions(a))
      }
      if (sub === 'approve') {
        const gate = admin(); if (gate) return gate
        if (a.status !== 'in_review') return err(409, `cannot approve an artifact that is ${a.status}; it must be in_review`)
        a.status = 'approved'; return ok(withActions(a))
      }
      if (sub === 'reject') {
        const gate = admin(); if (gate) return gate
        if (a.status !== 'in_review') return err(409, `cannot send back an artifact that is ${a.status}`)
        a.status = 'ready'; return ok(withActions(a))
      }
      if (sub === 'iterate') {
        const { instruction } = parseJson(init)
        if (typeof instruction !== 'string' || !instruction.trim()) return err(422, 'instruction must not be empty')
        if (LIVE.includes(a.status)) return err(409, 'wait for the current generation to finish before iterating')
        const latest = latestInBranch(rootOf(a))
        const child: Artifact = { ...a, id: nextId('a'), status: 'queued', version: latest.version + 1, parent_artifact_id: a.id, export_urls: {}, qa_report: {}, pages: [], created_at: now(), allowed_actions: undefined }
        db.artifacts.push(child)
        db.jobStarted[child.id] = Date.now()
        return ok(child)
      }
    }
  }
  return err(404, `mock: no route for ${method} ${path}`)
}

function fileToDataUrl(file: File): Promise<string | undefined> {
  if (typeof FileReader === 'undefined' || !file.type.startsWith('image/')) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

export async function mockResponse(url: string, init?: RequestInit): Promise<Response> {
  ensureHydrated()
  db.role = getMockRole()
  const parsed = new URL(url, 'http://mock')
  const path = parsed.pathname.replace(/^\/api\/v1/, '')
  const method = (init?.method ?? 'GET').toUpperCase()
  const ctx: Ctx = {}
  const upload = form(init).file
  if (upload) ctx.fileUrl = await fileToDataUrl(upload)
  await new Promise((r) => setTimeout(r, MOCK_LATENCY_MS))
  const reply = route(method, path, parsed.searchParams, init, ctx)
  saveMockState()
  if (reply.status === 204) return new Response(null, { status: 204 })
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
}
