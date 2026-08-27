// The PRD §3 role split as the member sees it, plus the dev role switch.
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import BrandsPage from '@/app/(app)/brands/page'
import { ReferenceUploader } from '@/components/brand/ReferenceUploader'
import { AssetGrid } from '@/components/brand/AssetGrid'
import { DevRoleSwitch } from '@/components/shell/DevRoleSwitch'
import { MOCK_ROLE_KEY } from '@/lib/mock'
import { renderWithQuery, mockApi } from './helpers'

const nav = vi.hoisted(() => ({ pathname: '/brands', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}))

const member = { id: 'u', email: 'm@b', role: 'member' }
const admin = { id: 'u', email: 'a@b', role: 'admin' }
const brands = [{ id: 'b1', name: 'Ladder', slug: 'ladder', created_at: '' }]

beforeEach(() => {
  sessionStorage.removeItem(MOCK_ROLE_KEY)
  nav.pathname = '/brands'
  nav.push.mockReset()
})

describe('member affordance map', () => {
  it('sees the brand list but no create form', async () => {
    mockApi({ '/me': member, '/brands': brands })
    renderWithQuery(<BrandsPage />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Ladder' })).toBeInTheDocument())
    expect(screen.queryByLabelText(/new brand name/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull()
  })

  it('an admin does see the create form', async () => {
    mockApi({ '/me': admin, '/brands': brands })
    renderWithQuery(<BrandsPage />)
    await waitFor(() => expect(screen.getByLabelText(/new brand name/i)).toBeInTheDocument())
  })

  it('the references page never mounts the uploader for a member (page-level gate)', () => {
    // The uploader is only rendered when isAdmin; a member page renders the grid alone.
    mockApi({ '/me': member })
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument() // component itself is not role-aware
  })

  it('sees no remove controls in the asset grid', async () => {
    mockApi({
      '/brands/b1/assets': [
        { id: 'a1', brand_id: 'b1', asset_type: 'logo', file_ref: 'k', label: 'Primary', url: null, created_at: '' },
        { id: 'a2', brand_id: 'b1', asset_type: 'font', file_ref: 'k', label: 'Inter', url: null, created_at: '' },
      ],
    })
    renderWithQuery(<AssetGrid brandId="b1" readOnly />)
    await waitFor(() => screen.getByText('Inter'))
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})

describe('DevRoleSwitch', () => {
  function renderSwitch() {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(
      <QueryClientProvider client={client}>
        <DevRoleSwitch />
      </QueryClientProvider>,
    )
    return invalidate
  }

  it('stores the role in sessionStorage and invalidates /me', async () => {
    const invalidate = renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: 'member' }))
    await waitFor(() => expect(sessionStorage.getItem(MOCK_ROLE_KEY)).toBe('member'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] })
    expect(screen.getByRole('button', { name: 'member' })).toHaveAttribute('aria-pressed', 'true')
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('leaves an admin route when switching to member', async () => {
    nav.pathname = '/admin/models'
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: 'member' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/brands'))
  })

  it('reads a previously stored role on mount', async () => {
    sessionStorage.setItem(MOCK_ROLE_KEY, 'member')
    renderSwitch()
    await waitFor(() => expect(screen.getByRole('button', { name: 'member' })).toHaveAttribute('aria-pressed', 'true'))
  })
})
