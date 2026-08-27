import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { Suspense } from 'react'
import { vi } from 'vitest'

export function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Next.js wraps every page in a Suspense boundary; pages that `use(params)` need one here too.
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>,
  )
}

type ErrorSpec = { status: number; detail: string }

export function mockApi(
  routes: Record<string, unknown>,
  errors: Partial<Record<string, ErrorSpec>> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const failure = errors[method]
      if (failure) {
        return new Response(JSON.stringify({ detail: failure.detail }), {
          status: failure.status,
          headers: { 'content-type': 'application/json' },
        })
      }
      const path = new URL(url, 'http://x').pathname.replace('/api/v1', '')
      const body = routes[path]
      if (body === undefined) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}
