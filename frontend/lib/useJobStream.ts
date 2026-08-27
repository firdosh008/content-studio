'use client'
import { useEffect, useRef, useState } from 'react'
import type { JobSnapshot } from '@/lib/types'

const TERMINAL = new Set(['succeeded', 'failed'])
const DEFAULT_RECONNECT_MS = 2000
// Auth failures are final: retrying without a session can never succeed.
const FATAL_STATUSES = new Set([401, 403])

export type StreamError = { status: number; detail: string }

/**
 * Follow one generation job.
 *
 * PRD 7.1 requires reconnectable progress: a member can close a laptop and come
 * back. The backend keeps progress in a database row, so recovery is just
 * reading the row again — this hook only has to survive a dropped socket.
 *
 * The stream is consumed through the same-origin proxy route
 * (app/api/artifacts/[artifactId]/job/stream) which injects the bearer token:
 * a bare EventSource cannot send an Authorization header. The proxy reports
 * auth/upstream failures as a named `stream_error` event so they can be told
 * apart from a dropped connection.
 */
export function useJobStream(
  artifactId: string | undefined,
  options: { reconnectMs?: number; url?: string } = {},
) {
  const reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS
  // Dev-only harness may point the hook at a scripted stream; production always uses the proxy.
  const streamUrl = options.url ?? (artifactId ? `/api/artifacts/${artifactId}/job/stream` : undefined)
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!artifactId) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    function stop(source: EventSource) {
      cancelled = true
      source.close()
      setConnected(false)
    }

    function open() {
      if (cancelled) return
      const source = new EventSource(streamUrl!)
      sourceRef.current = source
      setConnected(true)

      source.onmessage = (event: MessageEvent<string>) => {
        let payload: JobSnapshot
        try {
          payload = JSON.parse(event.data) as JobSnapshot
        } catch {
          return // a malformed frame is ignored; the stream stays open
        }
        if (!payload || typeof payload !== 'object' || typeof payload.state !== 'string') return
        setSnapshot(payload)
        setError(null)
        if (TERMINAL.has(payload.state)) stop(source)
      }

      source.addEventListener('stream_error', (event: MessageEvent<string>) => {
        let failure: StreamError = { status: 0, detail: 'stream error' }
        try {
          failure = { ...failure, ...(JSON.parse(event.data) as Partial<StreamError>) }
        } catch {}
        setError(failure.detail)
        if (FATAL_STATUSES.has(failure.status)) {
          stop(source)
        } else {
          source.close()
          setConnected(false)
          if (!cancelled) retryTimer = setTimeout(open, reconnectMs)
        }
      })

      source.onerror = () => {
        source.close()
        setConnected(false)
        if (!cancelled) retryTimer = setTimeout(open, reconnectMs)
      }
    }

    open()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      sourceRef.current?.close()
    }
  }, [artifactId, reconnectMs, streamUrl])

  return { snapshot, connected, error }
}
