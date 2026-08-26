import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CopyStage } from '@/components/copy/CopyStage'
import BriefPage from '@/app/(app)/briefs/[briefId]/page'
import { renderWithQuery, mockApi } from './helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/briefs/br1',
}))

const brief = {
  id: 'br1',
  brand_id: 'b1',
  content: 'launch',
  source: 'manual' as const,
  research_run_id: null,
  created_at: '',
}

const draftCopy = {
  id: 'c1',
  brief_id: 'br1',
  brand_id: 'b1',
  content: 'Words.',
  status: 'draft' as const,
  version: 1,
  generated_by_model_id: null,
  approved_by: null,
  created_at: '',
}

const admin = { id: 'u', email: 'a@b', role: 'admin' }
const member = { id: 'u', email: 'a@b', role: 'member' }

describe('CopyStage', () => {
  it('offers writing copy by hand as a first-class path', async () => {
    mockApi({ '/me': admin, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    // PRD 5.2: this path must exist and must not read as a fallback.
    await waitFor(() => expect(screen.getByRole('tab', { name: /write it/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /write it/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /generate/i })).toBeInTheDocument()
  })

  it('disables generate when the brand has no coding-agent model enabled', async () => {
    mockApi({ '/me': admin, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /generate/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /generate copy/i })).toBeDisabled())
    expect(screen.getByText(/no coding-agent model enabled/i)).toBeInTheDocument()
  })

  it('shows the VOICE.md error verbatim when generation is refused', async () => {
    mockApi(
      {
        '/me': admin,
        '/providers': [{ id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }],
      },
      { POST: { status: 422, detail: 'brand has no VOICE.md; author it before generating copy' } },
    )
    renderWithQuery(<CopyStage brief={brief} onApproved={vi.fn()} />)
    fireEvent.click(await screen.findByRole('tab', { name: /generate/i }))
    await waitFor(() => screen.getByRole('option', { name: 'claude' }))
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate copy/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'brand has no VOICE.md; author it before generating copy',
      ),
    )
  })

  it('shows an approve button to an admin on a draft', async () => {
    mockApi({ '/me': admin, '/briefs/br1/copy': draftCopy, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={draftCopy} onApproved={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /approve copy/i })).toBeInTheDocument())
  })

  it('hides approve from a member', async () => {
    mockApi({ '/me': member, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={draftCopy} onApproved={vi.fn()} />)
    await waitFor(() => screen.getByRole('tab', { name: /write it/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /approve copy/i })).toBeNull()
  })

  it('warns that editing approved copy returns it to draft', async () => {
    const approved = { ...draftCopy, status: 'approved' as const, approved_by: 'u' }
    mockApi({ '/me': admin, '/providers': [] })
    renderWithQuery(<CopyStage brief={brief} copy={approved} onApproved={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/^copy$/i), { target: { value: 'New words.' } })
    expect(screen.getByText(/return.*to draft/i)).toBeInTheDocument()
  })
})

// React's `use()` reads a pre-stamped thenable synchronously (see brief-new.test.tsx).
const params = Object.assign(Promise.resolve({ briefId: 'br1' }), {
  status: 'fulfilled',
  value: { briefId: 'br1' },
})

describe('BriefPage', () => {
  it('keeps design locked while there is no approved copy', async () => {
    // No /briefs/br1/copy route -> 404 -> "no copy yet".
    mockApi({ '/me': admin, '/providers': [], '/briefs/br1': brief })
    renderWithQuery(<BriefPage params={params} />)
    await waitFor(() =>
      expect(screen.getByText('Design unlocks once the copy is approved.')).toBeInTheDocument(),
    )
  })

  it('recovers an approved copy from the server on a fresh render, with design unlocked', async () => {
    // PRD 7.1: a reopened tab must not re-lock Design or lose the copy.
    const approved = { ...draftCopy, status: 'approved' as const, approved_by: 'u', version: 2 }
    mockApi({ '/me': admin, '/providers': [], '/briefs/br1': brief, '/briefs/br1/copy': approved })
    renderWithQuery(<BriefPage params={params} />)
    await waitFor(() => expect(screen.getByLabelText(/^copy$/i)).toHaveValue('Words.'))
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByText('Design unlocks once the copy is approved.')).toBeNull()
    expect(screen.getByRole('region', { name: /design/i })).toBeInTheDocument()
  })
})
