import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContractEditor } from '@/components/brand/ContractEditor'
import { renderWithQuery, mockApi } from './helpers'

describe('ContractEditor', () => {
  it('loads the current content into the textarea', async () => {
    mockApi({ '/brands/b1/design': { content: '# Ladder', version: 3, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# Ladder'))
  })

  it('shows the current version', async () => {
    mockApi({ '/brands/b1/voice': { content: '# V', version: 3, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="voice" readOnly={false} />)
    await waitFor(() => expect(screen.getByText(/version 3/i)).toBeInTheDocument())
  })

  it('disables save until the content changes', async () => {
    mockApi({ '/brands/b1/design': { content: '# a', version: 1, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeDisabled())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# b' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('hides save entirely for a member', async () => {
    mockApi({ '/brands/b1/design': { content: '# a', version: 1, updated_at: null } })
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly />)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeDisabled())
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('surfaces a backend error verbatim', async () => {
    mockApi(
      { '/brands/b1/design': { content: '', version: 0, updated_at: null } },
      { PUT: { status: 403, detail: 'admin only' } },
    )
    renderWithQuery(<ContractEditor brandId="b1" kind="design" readOnly={false} />)
    await waitFor(() => screen.getByRole('textbox'))
    expect(screen.getByText('not written yet')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('admin only'))
  })
})
