import type { NextRequest } from 'next/server'

/**
 * Dev-only SSE scenario harness (NEXT_PUBLIC_API_MOCK=true, never production).
 *
 * Serves scripted job streams so the real `useJobStream` hook and `JobProgress`
 * can be watched in a browser without a backend. The production proxy at
 * /api/artifacts/[artifactId]/job/stream is untouched; the dev page passes this
 * route's URL to the hook via its `url` option.
 *
 * Scenarios: ok | drop | malformed | failed | auth
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
}

const STEP_MS = 900
// "drop" closes the first connection early; the reconnect completes.
const connections = new Map<string, number>()

function snapshot(id: string, percent: number, extra: Record<string, unknown> = {}) {
  const stage = percent < 15 ? 'syncing_brand' : percent < 80 ? 'generating' : percent < 100 ? 'qa' : 'done'
  return { job_id: `job_${id}`, state: percent >= 100 ? 'succeeded' : 'running', attempts: 1, progress: { stage, percent }, error: null, ...extra }
}

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`

export async function GET(request: NextRequest, { params }: { params: Promise<{ scenario: string }> }) {
  if (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_API_MOCK !== 'true') {
    return new Response('not found', { status: 404 })
  }
  const { scenario } = await params
  const id = `sse_${scenario}`
  const attempt = (connections.get(scenario) ?? 0) + 1
  connections.set(scenario, attempt)

  if (scenario === 'auth') {
    return new Response(`event: stream_error\ndata: ${JSON.stringify({ status: 401, detail: 'not authenticated' })}\n\n`, { status: 200, headers: HEADERS })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text))
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const aborted = () => request.signal.aborted

      let percent = scenario === 'drop' && attempt > 1 ? 40 : 0
      if (scenario === 'malformed') {
        send(frame(snapshot(id, 10)))
        await wait(STEP_MS)
        send('data: {this is not json\n\n')
        await wait(STEP_MS)
        percent = 20
      }
      while (!aborted()) {
        send(frame(snapshot(id, percent)))
        if (scenario === 'drop' && attempt === 1 && percent >= 30) {
          // Simulate a dropped socket: close without a terminal state.
          connections.set(scenario, attempt)
          break
        }
        if (scenario === 'failed' && percent >= 50) {
          send(frame({ ...snapshot(id, 50), state: 'failed', attempts: 3, error: 'open-design unreachable after 3 attempts' }))
          break
        }
        if (percent >= 100) {
          connections.delete(scenario)
          break
        }
        percent = Math.min(100, percent + 10)
        await wait(STEP_MS)
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: HEADERS })
}
