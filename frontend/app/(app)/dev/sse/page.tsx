'use client'
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { API_MOCK } from '@/lib/mock'
import { JobProgress } from '@/components/generate/JobProgress'
import { Button } from '@/components/ui/Button'

// Dev-only page (NEXT_PUBLIC_API_MOCK=true): drives the real useJobStream hook
// and JobProgress against scripted server-sent streams from /api/mock/stream.
const SCENARIOS = [
  { key: 'ok', title: 'Normal progress to success', hint: 'Stages advance every ~1s and finish at 100%; the stream closes itself.' },
  { key: 'drop', title: 'Dropped connection, then reconnect', hint: 'The first connection dies at 30% without a terminal state; the hook reconnects after 2s and the job completes.' },
  { key: 'malformed', title: 'Malformed event, then valid progress', hint: 'A non-JSON frame is ignored; the stream stays open and progress continues.' },
  { key: 'failed', title: 'Terminal failure with the exact error', hint: 'The job fails at 50% and the alert shows the backend error verbatim.' },
  { key: 'auth', title: 'Fatal 401, no retry loop', hint: 'The proxy reports stream_error 401; the hook surfaces it and stops for good.' },
] as const

export default function SseScenariosPage() {
  const [runs, setRuns] = useState<Record<string, number>>({})
  if (!API_MOCK) notFound()

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-warning">
          <span aria-hidden="true">•</span> Dev only
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">SSE scenarios</h1>
        <p className="mt-2 text-sm text-text-muted">
          Each card connects the production <code className="font-mono text-xs">useJobStream</code> hook to a scripted
          stream at <code className="font-mono text-xs">/api/mock/stream/&#123;scenario&#125;</code>. No backend involved.
        </p>
      </div>
      <ul className="flex flex-col gap-5">
        {SCENARIOS.map((scenario) => {
          const run = runs[scenario.key] ?? 0
          return (
            <li key={scenario.key} className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-medium text-text">{scenario.title}</h2>
                  <p className="mt-1 text-sm text-text-muted">{scenario.hint}</p>
                </div>
                <Button variant="ghost" onClick={() => setRuns({ ...runs, [scenario.key]: run + 1 })}>
                  {run === 0 ? 'Start' : 'Restart'}
                </Button>
              </div>
              {run > 0 && (
                <JobProgress
                  key={`${scenario.key}-${run}`}
                  artifactId={`sse_${scenario.key}`}
                  streamUrl={`/api/mock/stream/${scenario.key}`}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
