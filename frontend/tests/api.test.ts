import { describe, expect, it, vi, beforeEach } from 'vitest'
import { apiFetch, ApiError } from '@/lib/api'

beforeEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
}

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(200, { id: 'b1', name: 'Ladder' })
    await expect(apiFetch('/brands')).resolves.toEqual({ id: 'b1', name: 'Ladder' })
  })

  it('throws ApiError carrying the backend detail', async () => {
    mockFetch(409, { detail: 'copy must be approved before design can start' })
    await expect(apiFetch('/artifacts', { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      detail: /must be approved/,
    })
  })

  it('surfaces a non-json error body as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway timeout', { status: 504 })))
    const error = await apiFetch('/brands').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).detail).toBe('gateway timeout')
    expect((error as ApiError).status).toBe(504)
  })

  it('returns undefined for a 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(apiFetch('/assets/a1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('attaches the bearer token', async () => {
    const spy = vi.fn<typeof fetch>(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', spy)
    await apiFetch('/me', { token: 'tok-1' })
    const headers = new Headers(spy.mock.calls[0][1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer tok-1')
  })

  it('sets a json content-type for json bodies but not for FormData', async () => {
    const spy = vi.fn<typeof fetch>(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', spy)
    await apiFetch('/brands', { method: 'POST', body: JSON.stringify({ name: 'x' }), token: 't' })
    await apiFetch('/brands/b1/assets', { method: 'POST', body: new FormData(), token: 't' })
    const jsonHeaders = new Headers(spy.mock.calls[0][1]?.headers)
    const formHeaders = new Headers(spy.mock.calls[1][1]?.headers)
    expect(jsonHeaders.get('content-type')).toBe('application/json')
    expect(formHeaders.get('content-type')).toBeNull()
  })
})
