'use client'
import { use, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact, ArtifactAction, Me } from '@/lib/types'
import { ArtifactViewer } from '@/components/artifact/ArtifactViewer'
import { QaReportPanel } from '@/components/artifact/QaReport'
import { IterateBox } from '@/components/artifact/IterateBox'
import { ExportPanel } from '@/components/artifact/ExportPanel'
import { VariantGrid } from '@/components/artifact/VariantGrid'
import { VersionTimeline } from '@/components/artifact/VersionTimeline'
import { JobProgress } from '@/components/generate/JobProgress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const LIVE = ['queued', 'generating']

// Display affordance only (constraint 3): an out-of-date map can at most show a
// button the backend then refuses, and that refusal's detail is shown verbatim.
// When the backend sends `allowed_actions`, that list wins and this map is unused.
function fallbackActions(artifact: Artifact): ArtifactAction[] {
  switch (artifact.status) {
    case 'ready':
      return ['submit', 'qa', 'iterate']
    case 'in_review':
      return ['approve', 'reject', 'iterate']
    case 'approved':
    case 'qa_failed':
      return ['qa', 'iterate']
    default:
      return []
  }
}

export default function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = use(params)
  const queryClient = useQueryClient()
  const key = ['artifact', artifactId]
  const [page, setPage] = useState(0)

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const artifact = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<Artifact>(`/artifacts/${artifactId}`),
    // While a job is live the row changes underneath us.
    refetchInterval: (query) => (LIVE.includes(query.state.data?.status ?? '') ? 3000 : false),
  })

  // Every surface that repeats this artifact's status — option cards, the
  // version timeline, the brand's artifact list, exports — must follow it.
  function invalidateStatusSurfaces() {
    queryClient.invalidateQueries({ queryKey: ['variants'] })
    queryClient.invalidateQueries({ queryKey: ['lineage'] })
    queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    queryClient.invalidateQueries({ queryKey: ['exports', artifactId] })
  }

  const lastStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    const status = artifact.data?.status
    if (status && lastStatus.current && lastStatus.current !== status) invalidateStatusSurfaces()
    lastStatus.current = status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.data?.status])

  const move = useMutation({
    mutationFn: (action: ArtifactAction) =>
      apiFetch<Artifact>(`/artifacts/${artifactId}/${action}`, { method: 'POST' }),
    onSuccess: (updated) => {
      queryClient.setQueryData(key, updated)
      invalidateStatusSurfaces()
    },
  })

  if (artifact.isLoading) return <Spinner />
  if (!artifact.data) return <ErrorBanner error={artifact.error ?? 'Artifact not found'} />
  const row = artifact.data
  const isAdmin = me.data?.role === 'admin'
  const allowed = new Set<ArtifactAction>(row.allowed_actions ?? fallbackActions(row))
  const live = LIVE.includes(row.status)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-8">
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> 03 Design
            <span className="mx-2 text-border">·</span>
            <Link href={`/brands/${row.brand_id}/artifacts`} className="hover:text-text">
              All artifacts
            </Link>
            <span className="mx-2 text-border">·</span>
            <Link href={`/briefs/${row.brief_id}`} className="hover:text-text">
              Brief
            </Link>
          </p>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-4xl text-text capitalize">
              {row.artifact_type.replace('_', ' ')}{' '}
              <span className="font-mono text-base text-text-muted">v{row.version}</span>
            </h1>
            <StatusBadge status={row.status} />
          </div>
        </div>
        {/* One failure-rendering path: the terminal job snapshot carries the exact reason. */}
        {(live || row.status === 'failed') && <JobProgress artifactId={row.id} />}
        <ArtifactViewer artifact={row} page={page} onPageChange={setPage} />
        <VariantGrid artifactId={row.id} current={row} />
      </div>

      <aside className="flex flex-col gap-6">
        <ErrorBanner error={move.error} />
        <QaReportPanel
          report={row.qa_report}
          status={row.status}
          onRerun={() => move.mutate('qa')}
          onSelectPage={setPage}
        />

        <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> 05 Approval
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {allowed.has('submit') && (
              <Button onClick={() => move.mutate('submit')} disabled={move.isPending}>
                Submit for review <span aria-hidden="true">→</span>
              </Button>
            )}
            {row.status === 'in_review' && isAdmin && (
              <>
                {allowed.has('approve') && (
                  <Button onClick={() => move.mutate('approve')} disabled={move.isPending}>
                    Approve
                  </Button>
                )}
                {allowed.has('reject') && (
                  <Button variant="ghost" onClick={() => move.mutate('reject')} disabled={move.isPending}>
                    Send back
                  </Button>
                )}
              </>
            )}
            {row.status === 'in_review' && !isAdmin && (
              <p className="text-sm text-text-muted">Waiting on an admin.</p>
            )}
            {row.status === 'approved' && (
              <p className="text-sm text-success">Approved. Iterating creates a new version.</p>
            )}
            {row.status === 'qa_failed' && (
              <p className="text-sm text-warning">Quality checks must pass before this can go to review.</p>
            )}
            {row.status === 'failed' && (
              <p className="text-sm text-danger">Generation failed. The job error above says why.</p>
            )}
            {live && <p className="text-sm text-text-muted">Generating. Come back when it is ready.</p>}
          </div>
        </section>

        <ExportPanel artifact={row} />
        {allowed.has('iterate') && <IterateBox artifactId={row.id} />}
        <VersionTimeline artifactId={row.id} current={row} />
      </aside>
    </div>
  )
}
