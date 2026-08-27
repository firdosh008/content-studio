import { createBrowserSupabase } from '@/lib/supabase/client'
import { API_MOCK } from '@/lib/mock'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

type FetchInit = RequestInit & { token?: string }

async function resolveToken(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit
  if (typeof window === 'undefined') return undefined
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return undefined
  }
  const { data } = await createBrowserSupabase().auth.getSession()
  return data.session?.access_token
}

// The backend's `detail` is the user-facing message. The frontend never
// rewrites it — a rule the API enforces should read the same in the UI.
// The body is read exactly once as text, then parsed; a second read would throw.
function extractDetail(raw: string, fallback: string): string {
  if (!raw) return fallback
  try {
    const body: unknown = JSON.parse(raw)
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      return typeof detail === 'string' ? detail : JSON.stringify(detail)
    }
    return JSON.stringify(body)
  } catch {
    return raw
  }
}

// Dev-only: the mock backend is loaded lazily so it never ships in a real bundle path.
async function mockRequest(url: string, init: RequestInit): Promise<Response> {
  const { mockResponse } = await import('@/lib/mock/handler')
  return mockResponse(url, init)
}

export async function apiFetch<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const bearer = await resolveToken(token)
  const merged = new Headers(headers)
  if (bearer) merged.set('authorization', `Bearer ${bearer}`)
  if (rest.body && !(rest.body instanceof FormData)) {
    merged.set('content-type', 'application/json')
  }

  const response = API_MOCK
    ? await mockRequest(`${BASE}${path}`, { ...rest, headers: merged })
    : await fetch(`${BASE}${path}`, { ...rest, headers: merged })

  if (!response.ok) {
    const raw = await response.text()
    throw new ApiError(response.status, extractDetail(raw, response.statusText))
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
