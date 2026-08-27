import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrandSwitcher } from '@/components/shell/BrandSwitcher'
import { ShellNav } from '@/components/shell/ShellNav'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { renderWithQuery, mockApi } from './helpers'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/brands/b2/design',
}))

const brands = [
  { id: 'b1', name: 'Ladder', slug: 'ladder', created_at: '' },
  { id: 'b2', name: 'Agent Loopr', slug: 'agent-loopr', created_at: '' },
]

describe('BrandSwitcher', () => {
  it('lists every brand', () => {
    render(<BrandSwitcher brands={brands} currentId="b1" />)
    expect(screen.getByRole('option', { name: 'Ladder' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Agent Loopr' })).toBeInTheDocument()
  })

  it('marks the current brand as selected', () => {
    render(<BrandSwitcher brands={brands} currentId="b2" />)
    expect(screen.getByRole('combobox')).toHaveValue('b2')
  })
})

describe('StatusBadge', () => {
  it('renders qa_failed as a readable label', () => {
    render(<StatusBadge status="qa_failed" />)
    expect(screen.getByText('QA failed')).toBeInTheDocument()
  })

  it('renders in_review as a readable label', () => {
    render(<StatusBadge status="in_review" />)
    expect(screen.getByText('In review')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('shows the title and the action', () => {
    render(<EmptyState title="No brands yet" action={<button>New brand</button>} />)
    expect(screen.getByText('No brands yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New brand' })).toBeInTheDocument()
  })
})

describe('ShellNav', () => {
  it('mounts the brand switcher with the current brand from the route and shows admin links to an admin', async () => {
    mockApi({ '/me': { id: 'u1', email: 'a@x.com', role: 'admin' }, '/brands': brands })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toHaveValue('b2'))
    expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute('href', '/admin/models')
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('href', '/admin/skills')
  })

  it('never shows admin links to a member', async () => {
    mockApi({ '/me': { id: 'u2', email: 'm@x.com', role: 'member' }, '/brands': brands })
    renderWithQuery(<ShellNav />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Brand' })).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Models' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Skills' })).toBeNull()
  })
})
