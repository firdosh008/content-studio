'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'
import { StatusBadge } from '@/components/ui/StatusBadge'

const LIVE = ['queued', 'generating']

function formatWhen(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// The durable discovery path (PRD 7.1): artifacts and their jobs live
// server-side, so a closed laptop loses nothing — come back, open Artifacts,
// find the generating row, watch it live.
export default function ArtifactsListPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const artifacts = useQuery({
    queryKey: ['artifacts', brandId],
    queryFn: () => apiFetch<Artifact[]>(`/artifacts?brand_id=${brandId}`),
    refetchInterval: (query) =>
      query.state.data?.some((a) => LIVE.includes(a.status)) ? 5000 : false,
  })

  const rows = [...(artifacts.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
      <NavLinks brandId={brandId} />
      <section className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> 03 Design
          </p>
          <h1 className="mt-2 font-display text-4xl text-text">Artifacts</h1>
        </div>
        <ErrorBanner error={artifacts.error} />
        {artifacts.isLoading && <Spinner />}
        {artifacts.isSuccess && rows.length === 0 && (
          <EmptyState
            title="No artifacts yet"
            hint="Generate one from an approved brief. Anything still generating shows up here, even after you close the tab."
          />
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
            {rows.map((artifact) => (
              <li key={artifact.id} className="flex items-center gap-4 px-4 py-3">
                <Link
                  href={`/artifacts/${artifact.id}`}
                  className="flex-1 text-sm text-text capitalize hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {artifact.artifact_type.replace('_', ' ')}{' '}
                  <span className="font-mono text-[11px] text-text-muted uppercase">v{artifact.version}</span>
                </Link>
                <StatusBadge status={artifact.status} />
                <span className="font-mono text-[11px] tracking-wider text-text-muted">
                  {formatWhen(artifact.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
