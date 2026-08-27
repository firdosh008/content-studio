import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ShellNav } from '@/components/shell/ShellNav'
import { renderWithQuery, mockApi } from './helpers'

const nav = vi.hoisted(() => ({ pathname: '/brands' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}))

const brands = [
  { id: 'b1', name: 'Ladder', slug: 'ladder', created_at: '' },
  { id: 'b2', name: 'Agent Loopr', slug: 'agent-loopr', created_at: '' },
]
const admin = { id: 'u', email: 'a@b', role: 'admin' }
const member = { id: 'u', email: 'm@b', role: 'member' }

function requestedPaths() {
  const spy = globalThis.fetch as unknown as { mock: { calls: [string][] } }
  return spy.mock.calls.map(([url]) => new URL(url, 'http://x').pathname.replace('/api/v1', ''))
}

beforeEach(() => {
  nav.pathname = '/brands'
})

describe('ShellNav brand context', () => {
  it('selects the route brand on /brands/{id}/...', async () => {
    nav.pathname = '/brands/b2/design'
    mockApi({ '/me': admin, '/brands': brands })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue('b2'))
    expect(requestedPaths().some((p) => p.startsWith('/briefs/') || p.startsWith('/artifacts/'))).toBe(false)
  })

  it("selects the brief's brand on /briefs/{id}", async () => {
    nav.pathname = '/briefs/br1'
    mockApi({
      '/me': admin,
      '/brands': brands,
      '/briefs/br1': { id: 'br1', brand_id: 'b2', content: 'x', source: 'manual', research_run_id: null, created_at: '' },
    })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue('b2'))
    expect(requestedPaths().some((p) => p.startsWith('/artifacts/'))).toBe(false)
  })

  it("selects the artifact's brand on /artifacts/{id}", async () => {
    nav.pathname = '/artifacts/a1'
    mockApi({
      '/me': admin,
      '/brands': brands,
      '/artifacts/a1': { id: 'a1', brand_id: 'b1', status: 'ready', artifact_type: 'carousel', version: 1 },
    })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue('b1'))
    expect(requestedPaths().some((p) => p.startsWith('/briefs/'))).toBe(false)
  })

  it('requests neither resource on the brand list or admin routes and shows no current brand', async () => {
    for (const pathname of ['/brands', '/admin/models', '/admin/skills']) {
      nav.pathname = pathname
      mockApi({ '/me': admin, '/brands': brands })
      const view = renderWithQuery(<ShellNav />)
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue(''))
      expect(requestedPaths().filter((p) => p.startsWith('/briefs/') || p.startsWith('/artifacts/'))).toEqual([])
      view.unmount()
    }
  })

  it('still hides admin links from a member on a brief route', async () => {
    nav.pathname = '/briefs/br1'
    mockApi({
      '/me': member,
      '/brands': brands,
      '/briefs/br1': { id: 'br1', brand_id: 'b1', content: 'x', source: 'manual', research_run_id: null, created_at: '' },
    })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue('b1'))
    expect(screen.queryByRole('link', { name: 'Models' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Skills' })).toBeNull()
  })
})
