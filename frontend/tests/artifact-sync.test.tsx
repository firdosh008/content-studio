import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ArtifactPage from '@/app/(app)/artifacts/[artifactId]/page'
import { VariantGrid } from '@/components/artifact/VariantGrid'
import { VersionTimeline } from '@/components/artifact/VersionTimeline'
import { ExportPanel } from '@/components/artifact/ExportPanel'
import type { Artifact } from '@/lib/types'
import { renderWithQuery, mockApi } from './helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/artifacts/a1',
}))

class FakeEventSource {
  onmessage: unknown = null
  onerror: unknown = null
  constructor(public url: string) {}
  addEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource))

const admin = { id: 'u', email: 'a@b', role: 'admin' }

function artifact(id: string, patch: Partial<Artifact> = {}): Artifact {
  return {
    id,
    brand_id: 'b1',
    brief_id: 'br1',
    copy_id: 'c1',
    artifact_type: 'carousel',
    generation_mode: 'code',
    model_provider_id: 'p1',
    status: 'ready',
    version: 1,
    parent_artifact_id: null,
    variant_group_id: 'vg1',
    open_design_project_ref: null,
    export_urls: {},
    qa_report: {},
    created_at: '2026-08-26T10:00:00Z',
    ...patch,
  }
}

const stamped = <T extends object>(value: T) =>
  Object.assign(Promise.resolve(value), { status: 'fulfilled', value })

/** fetch stub whose response for one path changes per call; counts calls per path. */
function sequencedApi(routes: Record<string, unknown | unknown[]>) {
  const calls: Record<string, number> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, 'http://x').pathname.replace('/api/v1', '')
      calls[path] = (calls[path] ?? 0) + 1
      const route = routes[path]
      if (route === undefined) return new Response('not found', { status: 404 })
      const body = Array.isArray(route) ? route[Math.min(calls[path] - 1, route.length - 1)] : route
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return calls
}

describe('failed artifact', () => {
  it('shows the exact job error in an alert and offers no approval or export actions', async () => {
    mockApi({
      '/me': admin,
      '/artifacts/a1': artifact('a1', { status: 'failed', artifact_type: 'social_post', variant_group_id: null }),
      '/artifacts/a1/job': {
        job_id: 'j1',
        state: 'failed',
        attempts: 3,
        progress: { stage: 'generating', percent: 40 },
        error: 'open-design unreachable after 3 attempts',
      },
      '/artifacts/a1/lineage': [],
      '/artifacts/a1/variants': [],
    })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('open-design unreachable after 3 attempts'))
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/generation failed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for review|^approve$|send back|apply edit/i })).toBeNull()
    expect(screen.getByText('Nothing to export yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })
})

describe('status surfaces stay in sync', () => {
  it('a generating variant updates to Ready without reopening, then polling stops', async () => {
    const calls = sequencedApi({
      '/artifacts/a1/variants': [
        [artifact('a1', { status: 'generating' }), artifact('a2')],
        [artifact('a1'), artifact('a2')],
      ],
    })
    renderWithQuery(<VariantGrid artifactId="a1" pollMs={30} />)
    await waitFor(() => expect(screen.getByText('Generating')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('Generating')).toBeNull())
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    const settled = calls['/artifacts/a1/variants']
    await new Promise((r) => setTimeout(r, 150))
    expect(calls['/artifacts/a1/variants']).toBe(settled)
  })

  it('a generating lineage entry updates to Ready', async () => {
    sequencedApi({
      '/artifacts/a2/lineage': [
        [artifact('a1', { variant_group_id: null }), artifact('a2', { status: 'generating', version: 2, parent_artifact_id: 'a1', variant_group_id: null })],
        [artifact('a1', { variant_group_id: null }), artifact('a2', { version: 2, parent_artifact_id: 'a1', variant_group_id: null })],
      ],
    })
    renderWithQuery(<VersionTimeline artifactId="a2" pollMs={30} />)
    await waitFor(() => expect(screen.getByText('Generating')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('Generating')).toBeNull())
    expect(screen.getAllByText('Ready')).toHaveLength(2)
  })

  it('overlays the current artifact so an approval shows in the variant grid immediately', async () => {
    mockApi({ '/artifacts/a1/variants': [artifact('a1', { status: 'in_review' }), artifact('a2')] })
    renderWithQuery(<VariantGrid artifactId="a1" current={artifact('a1', { status: 'approved' })} />)
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument())
    expect(screen.queryByText('In review')).toBeNull()
  })

  it('the page heading, variant card and timeline agree once a mocked job completes', async () => {
    sequencedApi({
      '/me': admin,
      '/artifacts/a2': [
        artifact('a2', { status: 'generating', version: 2, parent_artifact_id: 'a1' }),
        artifact('a2', { version: 2, parent_artifact_id: 'a1' }),
      ],
      '/artifacts/a2/job': { job_id: 'j', state: 'running', attempts: 1, progress: { stage: 'qa', percent: 90 }, error: null },
      '/artifacts/a2/variants': [
        [artifact('a2', { status: 'generating', version: 2, parent_artifact_id: 'a1' }), artifact('a3')],
        [artifact('a2', { version: 2, parent_artifact_id: 'a1' }), artifact('a3')],
      ],
      '/artifacts/a2/lineage': [
        [artifact('a1'), artifact('a2', { status: 'generating', version: 2, parent_artifact_id: 'a1' })],
        [artifact('a1'), artifact('a2', { version: 2, parent_artifact_id: 'a1' })],
      ],
      '/artifacts/a2/exports': {},
    })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a2' })} />)
    await waitFor(() => expect(screen.getAllByText('Generating').length).toBeGreaterThan(0))
    // The artifact query polls every 3s in the page; the variant/lineage rows must follow it.
    await waitFor(() => expect(screen.queryByText('Generating')).toBeNull(), { timeout: 8000 })
    const options = screen.getByText('Options from this brief').parentElement!
    expect(within(options).getAllByText('Ready')).toHaveLength(2)
    const versions = screen.getByText('Versions').parentElement!
    expect(within(versions).getAllByText('Ready')).toHaveLength(2)
  }, 15000)
})

describe('export copy', () => {
  it('omits the working-export warning once approved, keeps it while ready', async () => {
    mockApi({ '/artifacts/a1/exports': { png: '/mock-downloads/sample.png?artifact=a1&v=1' } })
    const first = renderWithQuery(<ExportPanel artifact={artifact('a1', { status: 'approved' })} />)
    await waitFor(() => screen.getByRole('link', { name: /png/i }))
    expect(screen.queryByText(/working exports/i)).toBeNull()
    first.unmount()
    renderWithQuery(<ExportPanel artifact={artifact('a1')} />)
    await waitFor(() => screen.getByRole('link', { name: /png/i }))
    expect(screen.getByText(/working exports/i)).toBeInTheDocument()
  })
})
