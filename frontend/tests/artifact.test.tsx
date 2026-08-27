import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QaReportPanel } from '@/components/artifact/QaReport'
import { ExportPanel } from '@/components/artifact/ExportPanel'
import { IterateBox } from '@/components/artifact/IterateBox'
import { ArtifactViewer } from '@/components/artifact/ArtifactViewer'
import ArtifactPage from '@/app/(app)/artifacts/[artifactId]/page'
import ArtifactsListPage from '@/app/(app)/brands/[brandId]/artifacts/page'
import { NavLinks } from '@/components/shell/NavLinks'
import { renderWithQuery, mockApi } from './helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/brands/b1/artifacts',
}))

class FakeEventSource {
  onmessage: unknown = null
  onerror: unknown = null
  constructor(public url: string) {}
  addEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource))

const passing = { passed: true, findings: [], checks_run: ['overflow', 'fill'], skipped: [] }
const failing = {
  passed: false,
  findings: [
    {
      check: 'overflow',
      severity: 'error' as const,
      page: null,
      detail: '<h1> content 812x40 exceeds box 400x40: "A very long headline"',
    },
    {
      check: 'fill',
      severity: 'error' as const,
      page: 3,
      detail: 'page 3 is 12% filled, below the 35% threshold — dead space',
    },
  ],
  checks_run: ['overflow', 'fill', 'palette'],
  skipped: ['determinism'],
}

const artifact = {
  id: 'a1',
  brand_id: 'b1',
  brief_id: 'br1',
  copy_id: 'c1',
  artifact_type: 'carousel' as const,
  generation_mode: 'code' as const,
  model_provider_id: 'p1',
  status: 'ready' as const,
  version: 1,
  parent_artifact_id: null,
  variant_group_id: null,
  open_design_project_ref: 'proj_42',
  export_urls: { png: 'http://od/e/1.png' },
  qa_report: passing,
  created_at: '2026-08-26T10:00:00Z',
}

const admin = { id: 'u', email: 'a@b', role: 'admin' }
const member = { id: 'u', email: 'a@b', role: 'member' }

describe('QaReportPanel', () => {
  it('says nothing was wrong when the gate passed', () => {
    renderWithQuery(<QaReportPanel report={passing} status="ready" onRerun={vi.fn()} />)
    expect(screen.getByText(/passed/i)).toBeInTheDocument()
  })

  it('lists every finding with its check name', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText(/text overflow/i)).toBeInTheDocument()
    expect(screen.getByText(/dead space/)).toBeInTheDocument()
    expect(screen.getByText(failing.findings[0].detail)).toBeInTheDocument()
  })

  it('shows which page a finding is on', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText('page 3')).toBeInTheDocument()
  })

  it('names the checks that were skipped', () => {
    renderWithQuery(<QaReportPanel report={failing} status="qa_failed" onRerun={vi.fn()} />)
    expect(screen.getByText(/determinism|two identical builds/i)).toBeInTheDocument()
  })

  it('says when checks have not run', () => {
    renderWithQuery(<QaReportPanel report={{}} status="generating" onRerun={vi.fn()} />)
    expect(screen.getByText('Quality checks have not run yet.')).toBeInTheDocument()
  })
})

describe('ExportPanel', () => {
  it('offers exports on a ready artifact', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' }, '/me': admin })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /png/i })).toHaveAttribute('href', 'https://signed/1.png'),
    )
  })

  it('explains that a final export needs approval', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' }, '/me': admin })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() => expect(screen.getByText(/approved.*final/i)).toBeInTheDocument())
  })

  it('offers the all-cards zip from the API response, as a signed url', async () => {
    mockApi({
      '/artifacts/a1/exports': { png: 'https://signed/1.png', zip: 'https://signed/cards.zip' },
      '/me': admin,
    })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /all cards/i })).toHaveAttribute(
        'href',
        'https://signed/cards.zip',
      ),
    )
  })

  it('never hand-builds a zip link the API did not return', async () => {
    mockApi({ '/artifacts/a1/exports': { png: 'https://signed/1.png' }, '/me': admin })
    renderWithQuery(<ExportPanel artifact={artifact} />)
    await waitFor(() => screen.getByRole('link', { name: /png/i }))
    expect(screen.queryByRole('link', { name: /all cards|zip/i })).toBeNull()
  })
})

describe('IterateBox', () => {
  it('sends the instruction and reports the new version', async () => {
    mockApi({
      '/artifacts/a1/iterate': { ...artifact, id: 'a2', version: 2, parent_artifact_id: 'a1', status: 'queued' },
      '/artifacts/a2/job': { job_id: 'j2', state: 'queued', attempts: 0, progress: { stage: 'queued', percent: 0 }, error: null },
    })
    renderWithQuery(<IterateBox artifactId="a1" />)
    fireEvent.change(screen.getByLabelText(/what should change/i), { target: { value: 'bigger headline' } })
    fireEvent.click(screen.getByRole('button', { name: /apply edit/i }))
    await waitFor(() => expect(screen.getByText(/version 2/i)).toBeInTheDocument())
  })

  it('will not send an empty instruction', () => {
    mockApi({})
    renderWithQuery(<IterateBox artifactId="a1" />)
    expect(screen.getByRole('button', { name: /apply edit/i })).toBeDisabled()
  })
})

describe('ArtifactViewer', () => {
  const paged = {
    ...artifact,
    pages: ['https://od/p/1.png', 'https://od/p/2.png', 'https://od/p/3.png'],
  }

  it('renders every page with navigation and a counter', () => {
    const onPageChange = vi.fn()
    render(<ArtifactViewer artifact={paged} page={0} onPageChange={onPageChange} />)
    expect(screen.getAllByRole('button', { name: /^page \d of 3$/i })).toHaveLength(3)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('shows the requested page in the main view', () => {
    render(<ArtifactViewer artifact={paged} page={2} onPageChange={vi.fn()} />)
    const main = screen.getByRole('img', { name: /page 3 of 3/i })
    expect(main).toHaveAttribute('src', 'https://od/p/3.png')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('derives pages from per-page export urls when the api sends those', () => {
    const viaExports = { ...artifact, export_urls: { png_2: 'https://od/e/2.png', png_1: 'https://od/e/1.png' } }
    render(<ArtifactViewer artifact={viaExports} page={0} onPageChange={vi.fn()} />)
    expect(screen.getByRole('img', { name: /page 1 of 2/i })).toHaveAttribute('src', 'https://od/e/1.png')
  })

  it('degrades to a simple view for a single image and a placeholder for none', () => {
    const { unmount } = render(<ArtifactViewer artifact={artifact} page={0} onPageChange={vi.fn()} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://od/e/1.png')
    expect(screen.queryByRole('button', { name: /next page/i })).toBeNull()
    unmount()
    render(<ArtifactViewer artifact={{ ...artifact, export_urls: {} }} page={0} onPageChange={vi.fn()} />)
    expect(screen.getByText('No preview yet.')).toBeInTheDocument()
  })
})

// React's `use()` reads a pre-stamped thenable synchronously (see brief-new.test.tsx).
function stamped<T extends object>(value: T) {
  return Object.assign(Promise.resolve(value), { status: 'fulfilled', value })
}

describe('ArtifactPage', () => {
  const pagedFailing = {
    ...artifact,
    status: 'qa_failed' as const,
    qa_report: failing,
    pages: ['https://od/p/1.png', 'https://od/p/2.png', 'https://od/p/3.png'],
  }

  it('switches the viewer to the page a QA finding points at', async () => {
    mockApi({ '/me': admin, '/artifacts/a1': pagedFailing, '/artifacts/a1/lineage': [], '/artifacts/a1/variants': [] })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => screen.getByText('1 / 3'))
    fireEvent.click(screen.getByRole('button', { name: /show page 3/i }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByText('Quality checks must pass before this can go to review.')).toBeInTheDocument()
  })

  it('renders live progress for a queued artifact', async () => {
    mockApi({
      '/me': member,
      '/artifacts/a1': { ...artifact, status: 'queued', export_urls: {}, qa_report: {} },
      '/artifacts/a1/job': { job_id: 'j1', state: 'queued', attempts: 0, progress: { stage: 'queued', percent: 0 }, error: null },
      '/artifacts/a1/lineage': [],
      '/artifacts/a1/variants': [],
    })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument())
    expect(screen.getByText('Quality checks have not run yet.')).toBeInTheDocument()
  })

  it('shows the admin approval actions only in review, and tells a member to wait', async () => {
    const inReview = { ...artifact, status: 'in_review' as const }
    mockApi({ '/me': admin, '/artifacts/a1': inReview, '/artifacts/a1/lineage': [], '/artifacts/a1/variants': [], '/artifacts/a1/exports': {} })
    const first = renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /send back/i })).toBeInTheDocument()
    first.unmount()

    mockApi({ '/me': member, '/artifacts/a1': inReview, '/artifacts/a1/lineage': [], '/artifacts/a1/variants': [], '/artifacts/a1/exports': {} })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => expect(screen.getByText('Waiting on an admin.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
  })

  it('renders actions from allowed_actions when the backend provides them', async () => {
    // The backend is the referee: with allowed_actions present, the local status map is ignored.
    const ready = { ...artifact, allowed_actions: ['qa', 'iterate'] as const }
    mockApi({ '/me': admin, '/artifacts/a1': ready, '/artifacts/a1/lineage': [], '/artifacts/a1/variants': [], '/artifacts/a1/exports': {} })
    renderWithQuery(<ArtifactPage params={stamped({ artifactId: 'a1' })} />)
    await waitFor(() => screen.getByRole('button', { name: /re-run checks/i }))
    expect(screen.getByRole('button', { name: /apply edit/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for review/i })).toBeNull()
  })
})

describe('Artifacts list', () => {
  it('lists a queued artifact newest first and links to its page', async () => {
    mockApi({
      '/artifacts': [
        { ...artifact, id: 'old', status: 'approved', created_at: '2026-08-25T10:00:00Z' },
        { ...artifact, id: 'a9', status: 'queued', created_at: '2026-08-26T12:00:00Z' },
      ],
    })
    renderWithQuery(<ArtifactsListPage params={stamped({ brandId: 'b1' })} />)
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/artifacts/a9')
    expect(within(rows[0]).getByText('Queued')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Approved')).toBeInTheDocument()
  })

  it('has an Artifacts entry in the brand nav', () => {
    render(<NavLinks brandId="b1" />)
    const link = screen.getByRole('link', { name: 'Artifacts' })
    expect(link).toHaveAttribute('href', '/brands/b1/artifacts')
    expect(link).toHaveAttribute('aria-current', 'page')
  })
})
