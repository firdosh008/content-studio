import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ModelsPage from '@/app/(app)/admin/models/page'
import SkillsPage from '@/app/(app)/admin/skills/page'
import { renderWithQuery, mockApi } from './helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/models',
}))

const admin = { id: 'u', email: 'a@b', role: 'admin' as const }
const claude = { id: 'p1', type: 'coding_agent', name: 'claude', enabled: true, created_at: '' }

describe('models admin', () => {
  it('never renders an api key back to the screen', async () => {
    mockApi({ '/me': admin, '/providers': [claude] })
    const { container } = renderWithQuery(<ModelsPage />)
    await waitFor(() => screen.getByText('claude'))
    expect(container.textContent).not.toMatch(/sk-/)
    expect(screen.getByLabelText(/api key/i)).toHaveAttribute('type', 'password')
    expect(screen.getByText('Encrypted on save. Never shown again.')).toBeInTheDocument()
  })

  it('lets an admin disable a provider', async () => {
    mockApi({ '/me': admin, '/providers': [claude], '/providers/p1': { ...claude, enabled: false } })
    renderWithQuery(<ModelsPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /disable/i }))
    await waitFor(() => {
      const patch = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.find(
        ([, init]) => init?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
      expect(JSON.parse(patch![1]?.body as string)).toEqual({ enabled: false })
    })
  })

  it('tells a member this page is admin-only', async () => {
    mockApi({ '/me': { ...admin, role: 'member' }, '/providers': [] })
    renderWithQuery(<ModelsPage />)
    await waitFor(() => expect(screen.getByText(/admin only/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
  })
})

describe('skills admin', () => {
  it('does not offer image as a scope', async () => {
    mockApi({ '/me': admin, '/skills': [] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => screen.getByText(/upload a skill/i))
    // PRD 6.4: image-mode has no coding agent, so no skill can target it.
    expect(screen.queryByLabelText('image')).toBeNull()
    for (const scope of ['social_post', 'carousel', 'deck', 'single_pager']) {
      expect(screen.getByLabelText(scope)).toBeInTheDocument()
    }
  })

  it('explains why image is absent', async () => {
    mockApi({ '/me': admin, '/skills': [] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => expect(screen.getByText(/no coding agent.*image/i)).toBeInTheDocument())
  })

  it('lists an uploaded skill with its scopes', async () => {
    mockApi({
      '/me': admin,
      '/skills': [{ id: 's1', name: 'hallmark', storage_ref: 'k', applies_to: ['single_pager'], enabled: true, created_at: '' }],
    })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => expect(screen.getByText('hallmark')).toBeInTheDocument())
    expect(within(screen.getByRole('listitem')).getByText(/single_pager/)).toBeInTheDocument()
  })

  it('tells a member this page is admin-only', async () => {
    mockApi({ '/me': { ...admin, role: 'member' }, '/skills': [] })
    renderWithQuery(<SkillsPage />)
    await waitFor(() => expect(screen.getByText(/admin only/i)).toBeInTheDocument())
  })
})
