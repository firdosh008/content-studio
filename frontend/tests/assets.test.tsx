import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AssetUploader } from '@/components/brand/AssetUploader'
import { AssetGrid } from '@/components/brand/AssetGrid'
import { renderWithQuery, mockApi } from './helpers'

const assets = [
  {
    id: 'a1',
    brand_id: 'b1',
    asset_type: 'logo' as const,
    file_ref: 'k1',
    label: 'Primary',
    url: 'https://s/logo.svg',
    created_at: '',
  },
  {
    id: 'a2',
    brand_id: 'b1',
    asset_type: 'font' as const,
    file_ref: 'k2',
    label: 'Inter',
    url: 'https://s/Inter.ttf',
    created_at: '',
  },
]

describe('AssetUploader', () => {
  it('offers every asset type including font', () => {
    mockApi({})
    renderWithQuery(<AssetUploader brandId="b1" />)
    const select = screen.getByLabelText(/^type$/i)
    for (const type of ['logo', 'font', 'headshot', 'screenshot', 'icon']) {
      expect(select).toHaveTextContent(type)
    }
  })

  it('surfaces the font-extension rejection verbatim', async () => {
    mockApi(
      {},
      { POST: { status: 422, detail: "font file must be one of ['.otf', '.ttf', '.woff', '.woff2']" } },
    )
    renderWithQuery(<AssetUploader brandId="b1" />)
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [new File(['x'], 'inter.png')] } })
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "font file must be one of ['.otf', '.ttf', '.woff', '.woff2']",
      ),
    )
  })
})

describe('AssetGrid', () => {
  it('groups fonts separately from images', async () => {
    mockApi({ '/brands/b1/assets': assets })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: /fonts/i })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /logos and images/i })).toBeInTheDocument()
    expect(screen.getByText('Inter')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('warns when a brand has no fonts uploaded', async () => {
    mockApi({ '/brands/b1/assets': [assets[0]] })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    // PRD 4.4: without self-hosted fonts, typography silently falls back.
    await waitFor(() => expect(screen.getByText(/no brand fonts uploaded/i)).toBeInTheDocument())
    expect(screen.getByText(/font QA check will fail/i)).toBeInTheDocument()
  })

  it('does not warn once a font exists', async () => {
    mockApi({ '/brands/b1/assets': assets })
    renderWithQuery(<AssetGrid brandId="b1" readOnly={false} />)
    await waitFor(() => screen.getByText('Inter'))
    expect(screen.queryByText(/no brand fonts/i)).toBeNull()
  })

  it('hides remove from a member', async () => {
    mockApi({ '/brands/b1/assets': assets })
    renderWithQuery(<AssetGrid brandId="b1" readOnly />)
    await waitFor(() => screen.getByText('Inter'))
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})
