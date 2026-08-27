import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReferenceUploader } from '@/components/brand/ReferenceUploader'
import { ReferenceGrid } from '@/components/brand/ReferenceGrid'
import { renderWithQuery, mockApi } from './helpers'

const refs = [
  {
    id: 'r1',
    brand_id: 'b1',
    file_ref: 'k1',
    file_type: 'image' as const,
    scope: 'social' as const,
    role: 'layout' as const,
    extracted_layout_spec: null,
    url: 'https://s/1.png',
    created_at: '',
  },
  {
    id: 'r2',
    brand_id: 'b1',
    file_ref: 'k2',
    file_type: 'pptx' as const,
    scope: 'presentation' as const,
    role: 'layout' as const,
    extracted_layout_spec: 'slide_size: 13.33x7.50in',
    url: 'https://s/2.pptx',
    created_at: '',
  },
]

describe('ReferenceUploader', () => {
  it('requires both a scope and a role', () => {
    mockApi({})
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    expect(screen.getByLabelText(/scope/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument()
  })

  it('explains that tagging beats describing', () => {
    mockApi({})
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    expect(screen.getByText(/tag it, don't describe it/i)).toBeInTheDocument()
  })

  it('surfaces a corrupt-pptx rejection verbatim', async () => {
    mockApi({}, { POST: { status: 422, detail: 'unreadable pptx: File is not a zip file' } })
    renderWithQuery(<ReferenceUploader brandId="b1" />)
    const input = screen.getByLabelText(/file/i)
    fireEvent.change(input, { target: { files: [new File(['x'], 'bad.pptx')] } })
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('unreadable pptx: File is not a zip file'),
    )
  })
})

describe('ReferenceGrid', () => {
  it('shows the scope and role tags on each reference', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getAllByText(/^layout$/i).length).toBe(2))
    expect(screen.getByText('social')).toBeInTheDocument()
    expect(screen.getByText('presentation')).toBeInTheDocument()
  })

  it('marks a pptx as parsed', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getByText(/layout spec extracted/i)).toBeInTheDocument())
  })

  it('sets expectations about what references do', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    // PRD 4.3: consistent brand feel, not pixel-exact reproduction.
    await waitFor(() =>
      expect(screen.getByText(/consistent brand feel, not pixel-exact/i)).toBeInTheDocument(),
    )
  })

  it('shows the non-pixel-exact guidance even when the library is empty', async () => {
    mockApi({ '/brands/b1/references': [] })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly />)
    await waitFor(() => expect(screen.getByText('No references yet')).toBeInTheDocument())
    expect(screen.getAllByText(/consistent brand feel, not pixel-exact/i)).toHaveLength(1)
    expect(screen.getByText(/upload screenshots and .pptx files/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })

  it('shows the guidance exactly once with a populated library', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly={false} />)
    await waitFor(() => screen.getByText('social'))
    expect(screen.getAllByText(/consistent brand feel, not pixel-exact/i)).toHaveLength(1)
  })

  it('hides delete from a member', async () => {
    mockApi({ '/brands/b1/references': refs })
    renderWithQuery(<ReferenceGrid brandId="b1" readOnly />)
    await waitFor(() => screen.getByText('social'))
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})
