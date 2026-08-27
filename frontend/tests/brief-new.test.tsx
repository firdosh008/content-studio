import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NewBriefPage from '@/app/(app)/brands/[brandId]/briefs/new/page'
import { renderWithQuery, mockApi } from './helpers'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/brands/b1/briefs/new',
}))

// React's `use()` reads a thenable synchronously once it carries status/value
// (what React itself stamps after the first resolution). Pre-stamping makes
// the first render deterministic instead of depending on scheduler timing.
const params = Object.assign(Promise.resolve({ brandId: 'b1' }), {
  status: 'fulfilled',
  value: { brandId: 'b1' },
})

function postsTo(path: string) {
  const spy = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }
  return spy.mock.calls.filter(
    ([url, init]) =>
      (init?.method ?? 'GET').toUpperCase() === 'POST' &&
      new URL(url, 'http://x').pathname.replace('/api/v1', '') === path,
  )
}

describe('new brief', () => {
  it('offers a manual brief by default', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => expect(screen.getByLabelText(/^brief$/i)).toBeInTheDocument())
  })

  it('offers pulling a research thesis', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pull.*research/i })).toBeInTheDocument(),
    )
  })

  it('lets the member edit a pulled thesis before saving', async () => {
    mockApi({
      '/briefs/from-research': { content: 'Pulled thesis text', research_run_id: 'run-1' },
    })
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => screen.getByRole('button', { name: /pull.*research/i }))
    fireEvent.change(screen.getByLabelText(/research question/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /pull.*research/i }))
    // PRD 5.1: never auto-generate from a pulled thesis without a review step.
    await waitFor(() => expect(screen.getByLabelText(/^brief$/i)).toHaveValue('Pulled thesis text'))
    expect(screen.getByText(/pre-filled from research run run-1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save brief/i })).toBeEnabled()
  })

  it('creates exactly one brief row: none on pull, one on save', async () => {
    mockApi({
      '/briefs/from-research': { content: 'Pulled thesis text', research_run_id: 'run-1' },
      '/briefs': {
        id: 'br1',
        brand_id: 'b1',
        content: 'Pulled thesis text',
        source: 'research_agent',
        research_run_id: 'run-1',
        created_at: '',
      },
    })
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => screen.getByRole('button', { name: /pull.*research/i }))
    fireEvent.change(screen.getByLabelText(/research question/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /pull.*research/i }))
    await waitFor(() => expect(screen.getByLabelText(/^brief$/i)).toHaveValue('Pulled thesis text'))
    expect(postsTo('/briefs')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /save brief/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/briefs/br1'))
    expect(postsTo('/briefs')).toHaveLength(1)
    const body = JSON.parse(postsTo('/briefs')[0][1]?.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      brand_id: 'b1',
      source: 'research_agent',
      research_run_id: 'run-1',
      content: 'Pulled thesis text',
    })
  })

  it('falls back to manual when no research agent is configured', async () => {
    mockApi(
      {},
      { POST: { status: 503, detail: 'no research agent configured; briefs are manual-only' } },
    )
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => screen.getByRole('button', { name: /pull.*research/i }))
    fireEvent.change(screen.getByLabelText(/research question/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /pull.*research/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('manual-only'))
    expect(screen.getByLabelText(/^brief$/i)).toBeEnabled()
  })

  it('will not save an empty brief', async () => {
    mockApi({})
    renderWithQuery(<NewBriefPage params={params} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /save brief/i })).toBeDisabled())
  })
})
