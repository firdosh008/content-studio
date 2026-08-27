'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { StatusBadge } from '@/components/ui/StatusBadge'

const LIVE = new Set(['queued', 'generating'])
export const DEFAULT_POLL_MS = 3000

export function VersionTimeline({
  artifactId,
  current,
  pollMs = DEFAULT_POLL_MS,
}: {
  artifactId: string
  // Overlaid on the matching version so the timeline never contradicts the heading.
  current?: Artifact
  pollMs?: number
}) {
  const lineage = useQuery({
    queryKey: ['lineage', artifactId],
    queryFn: () => apiFetch<Artifact[]>(`/artifacts/${artifactId}/lineage`),
    refetchInterval: (query) => (query.state.data?.some((v) => LIVE.has(v.status)) ? pollMs : false),
  })
  const rows = (lineage.data ?? []).map((v) => (current && v.id === current.id ? { ...v, ...current } : v))
  if (rows.length < 2) return null

  return (
    <section className="flex flex-col gap-2">
      <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
        <span className="text-accent">•</span> Versions
      </p>
      <ol className="flex flex-col gap-1 text-sm">
        {rows.map((version) => (
          <li key={version.id} className="flex items-center gap-2">
            <Link
              href={`/artifacts/${version.id}`}
              aria-current={version.id === artifactId ? 'page' : undefined}
              className={`font-mono text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                version.id === artifactId ? 'text-accent' : 'text-text-muted underline underline-offset-4 hover:text-text'
              }`}
            >
              v{version.version}
            </Link>
            <StatusBadge status={version.status} />
          </li>
        ))}
      </ol>
    </section>
  )
}
