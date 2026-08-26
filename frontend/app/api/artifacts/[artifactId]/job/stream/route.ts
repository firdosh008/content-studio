import type { NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

// A failure delivered *inside* a 200 SSE response, as a named event. A bare
// 401 would be indistinguishable from a dropped socket to EventSource, which
// would then retry forever; a named event lets the hook stop for good.
function errorEvent(status: number, detail: string) {
  const frame = `event: stream_error\ndata: ${JSON.stringify({ status, detail })}\n\n`
  return new Response(frame, { status: 200, headers: SSE_HEADERS })
}

/**
 * Same-origin proxy for the backend's job stream.
 *
 * EventSource cannot send an Authorization header, so the browser connects
 * here; this handler reads the Supabase session from cookies, opens the
 * backend stream with the bearer, and pipes the bytes straight back.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return errorEvent(401, 'not authenticated')

  let upstream: Response
  try {
    upstream = await fetch(`${BASE}/artifacts/${encodeURIComponent(artifactId)}/job/stream`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: request.signal,
      cache: 'no-store',
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'backend unreachable'
    return errorEvent(502, detail)
  }

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text().catch(() => '')
    let detail = raw || upstream.statusText
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const d = (parsed as { detail: unknown }).detail
        detail = typeof d === 'string' ? d : JSON.stringify(d)
      }
    } catch {}
    return errorEvent(upstream.status, detail)
  }

  return new Response(upstream.body, { status: 200, headers: SSE_HEADERS })
}
