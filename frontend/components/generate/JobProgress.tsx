'use client'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useJobStream } from '@/lib/useJobStream'
import type { JobSnapshot } from '@/lib/types'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { API_MOCK } from '@/lib/mock'

const STAGE_LABELS: Record<string, string> = {
  queued: 'Waiting for a free generation slot',
  starting: 'Starting',
  syncing_brand: 'Syncing brand system, assets and fonts',
  generating: 'Generating with open-design',
  qa: 'Running quality checks',
  done: 'Done',
  running: 'Generating',
  succeeded: 'Done',
  failed: 'Failed',
}

const TERMINAL = new Set(['succeeded', 'failed'])

export function JobProgress({ artifactId, streamUrl }: { artifactId: string; streamUrl?: string }) {
  const useStream = !API_MOCK || Boolean(streamUrl)
  // The snapshot query is what makes a reopened page correct immediately;
  // the stream then takes over for live updates.
  const initial = useQuery({
    queryKey: ['job', artifactId],
    queryFn: () => apiFetch<JobSnapshot>(`/artifacts/${artifactId}/job`),
    // Mock mode has no SSE stream: poll the snapshot instead.
    refetchInterval: (query) =>
      !useStream && !TERMINAL.has(query.state.data?.state ?? '') ? 1000 : false,
  })
  const initialTerminal = initial.data ? TERMINAL.has(initial.data.state) : false
  const { snapshot: live, connected, error: streamError } = useJobStream(
    initialTerminal || !useStream ? undefined : artifactId,
    { url: streamUrl },
  )
  const snapshot = live ?? initial.data
  if (!snapshot) return initial.error ? <ErrorBanner error={initial.error} /> : null

  const percent = Math.max(0, Math.min(100, snapshot.progress.percent ?? 0))
  const stage = snapshot.progress.stage ?? snapshot.state
  const label = STAGE_LABELS[stage] ?? stage
  const terminal = TERMINAL.has(snapshot.state)

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-text">
          {!terminal && (
            <span aria-hidden="true" className="animate-pulse text-accent">
              •
            </span>
          )}
          {label}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          {percent}%{!terminal && connected ? ' · live' : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-inset">
        <div
          className={`h-full transition-all ${snapshot.state === 'failed' ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-label={label}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-widest text-text-muted">
        {snapshot.attempts > 1 && <span>Attempt {snapshot.attempts}</span>}
        {snapshot.progress.detail && <span className="normal-case tracking-normal">{snapshot.progress.detail}</span>}
        {streamError && !terminal && <span className="text-warning">Live updates paused: {streamError}</span>}
      </div>
      {snapshot.state === 'failed' && (
        <ErrorBanner error={new Error(snapshot.error ?? 'Generation failed')} />
      )}
    </div>
  )
}
