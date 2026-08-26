// Dev mock infrastructure: reload persistence, runtime role, export fixtures,
// and variant-vs-iteration branch semantics. Pure handler tests, no React.
import { describe, expect, it, beforeEach } from 'vitest'
import { mockResponse } from '@/lib/mock/handler'
import { db, forgetMockStateForTests, MOCK_JOB_DURATION_MS, resetMockState, seed } from '@/lib/mock/data'
import { MOCK_ROLE_KEY, setMockRole } from '@/lib/mock'
import type { Artifact, Brief, Copy, JobSnapshot } from '@/lib/types'

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await mockResponse(`http://localhost:8000/api/v1${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: res.status === 204 ? (undefined as T) : ((await res.json()) as T) }
}

// Simulates the browser tab reloading: in-memory state is dropped and the next
// request re-reads the sessionStorage snapshot.
const reload = () => forgetMockStateForTests()

beforeEach(() => {
  sessionStorage.removeItem(MOCK_ROLE_KEY)
  resetMockState()
})

describe('persistence across a reload', () => {
  it('a created brief is still there after a reload', async () => {
    const created = await call<Brief>('POST', '/briefs', { brand_id: 'b_ladder', content: 'Reload me' })
    expect(created.status).toBe(200)
    reload()
    const fetched = await call<Brief>('GET', `/briefs/${created.body.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.content).toBe('Reload me')
  })

  it('approved copy stays approved after a reload', async () => {
    const approved = await call<Copy>('POST', '/copy/c_pilot/approve')
    expect(approved.body.status).toBe('approved')
    reload()
    const copy = await call<Copy>('GET', '/briefs/br_pilot/copy')
    expect(copy.body.status).toBe('approved')
  })

  it('a running artifact and its job progress survive a reload', async () => {
    const created = await call<Artifact[]>('POST', '/artifacts', {
      brand_id: 'b_ladder', brief_id: 'br_pricing', copy_id: 'c_pricing', artifact_type: 'carousel', model_provider_id: 'p_claude', variants: 1,
    })
    const id = created.body[0].id
    const startedAt = db.jobStarted[id]
    expect(startedAt).toBeDefined()
    reload()
    const job = await call<JobSnapshot>('GET', `/artifacts/${id}/job`)
    expect(job.status).toBe(200)
    expect(['queued', 'running']).toContain(job.body.state)
    expect(db.jobStarted[id]).toBe(startedAt) // progress resumes, it does not restart
    const list = await call<Artifact[]>('GET', '/artifacts?brand_id=b_ladder')
    expect(list.body.some((a) => a.id === id)).toBe(true)
  })

  it('reset restores the original fixtures', async () => {
    await call('POST', '/brands', { name: 'Temporary' })
    expect((await call<unknown[]>('GET', '/brands')).body).toHaveLength(3)
    resetMockState()
    expect((await call<unknown[]>('GET', '/brands')).body).toHaveLength(seed().brands.length)
    expect(sessionStorage.getItem('cs-mock-db')).not.toContain('Temporary')
  })
})

describe('runtime mock role', () => {
  it('/me follows the sessionStorage role and admin-only routes refuse a member', async () => {
    expect((await call<{ role: string }>('GET', '/me')).body.role).toBe('admin')
    setMockRole('member')
    expect((await call<{ role: string }>('GET', '/me')).body.role).toBe('member')
    const refused = await call<{ detail: string }>('POST', '/brands', { name: 'Nope' })
    expect(refused.status).toBe(403)
    expect(refused.body.detail).toBe('admin only')
    const approve = await call<{ detail: string }>('POST', '/artifacts/a_review/approve')
    expect(approve.status).toBe(403)
    // Member-authorised work still goes through.
    expect((await call('POST', '/briefs', { brand_id: 'b_ladder', content: 'member brief' })).status).toBe(200)
    expect((await call('POST', '/artifacts/a_ready/submit')).status).toBe(200)
  })
})

describe('export fixtures', () => {
  it('a carousel gets PNG and ZIP as distinct real files', async () => {
    const { body } = await call<Record<string, string>>('GET', '/artifacts/a_ready/exports')
    expect(Object.keys(body).sort()).toEqual(['png', 'zip'])
    expect(body.png).not.toBe(body.zip)
    expect(body.png).toMatch(/^\/mock-downloads\/sample\.png\?/)
    expect(body.zip).toMatch(/^\/mock-downloads\/sample\.zip\?/)
  })

  it('a deck gets the deck formats and an image never gets them', async () => {
    const deck = await call<Record<string, string>>('GET', '/artifacts/a_v2/exports')
    expect(Object.keys(deck.body).sort()).toEqual(['pdf', 'pptx'])
    expect(deck.body.pptx).toMatch(/\.pptx\?/)
    const image = await call<Record<string, string>>('GET', '/artifacts/a_image/exports')
    expect(Object.keys(image.body).sort()).toEqual(['jpg', 'png'])
    expect(image.body).not.toHaveProperty('pptx')
    expect(image.body).not.toHaveProperty('zip')
  })

  it('refuses exports while generating', async () => {
    const res = await call<{ detail: string }>('GET', '/artifacts/a_live/exports')
    expect(res.status).toBe(409)
  })
})

describe('variants vs iterations', () => {
  async function finish(id: string) {
    db.jobStarted[id] = Date.now() - MOCK_JOB_DURATION_MS - 1
    await call('GET', `/artifacts/${id}`)
  }

  it('iterating an option keeps two options, pointing option 1 at its latest version', async () => {
    const created = await call<Artifact[]>('POST', '/artifacts', {
      brand_id: 'b_ladder', brief_id: 'br_pricing', copy_id: 'c_pricing', artifact_type: 'carousel', model_provider_id: 'p_claude', variants: 2,
    })
    const [one, two] = created.body
    await finish(one.id)
    await finish(two.id)
    expect((await call<Artifact[]>('GET', `/artifacts/${one.id}/variants`)).body.map((a) => a.id)).toEqual([one.id, two.id])

    const child = (await call<Artifact>('POST', `/artifacts/${one.id}/iterate`, { instruction: 'bigger headline' })).body
    expect(child.version).toBe(2)
    expect(child.parent_artifact_id).toBe(one.id)

    const fromChild = (await call<Artifact[]>('GET', `/artifacts/${child.id}/variants`)).body
    expect(fromChild).toHaveLength(2)
    expect(fromChild[0].id).toBe(child.id) // option 1 now points at v2
    expect(fromChild[1].id).toBe(two.id) // option 2 untouched

    const fromTwo = (await call<Artifact[]>('GET', `/artifacts/${two.id}/variants`)).body
    expect(fromTwo.map((a) => a.id)).toEqual([child.id, two.id])

    const lineage = (await call<Artifact[]>('GET', `/artifacts/${child.id}/lineage`)).body
    expect(lineage.map((a) => a.version)).toEqual([1, 2])
    expect(lineage.map((a) => a.id)).toEqual([one.id, child.id])
    expect((await call<Artifact[]>('GET', `/artifacts/${two.id}/lineage`)).body).toHaveLength(1)
  })
})
