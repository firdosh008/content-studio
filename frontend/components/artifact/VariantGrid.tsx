'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { StatusBadge } from '@/components/ui/StatusBadge'

const LIVE = new Set(['queued', 'generating'])
export const DEFAULT_POLL_MS = 3000

export function VariantGrid({
  artifactId,
  current,
  pollMs = DEFAULT_POLL_MS,
}: {
  artifactId: string
  // The page's own artifact response — overlaid on the matching row so the
  // current option can never show a status the heading has already moved past.
  current?: Artifact
  pollMs?: number
}) {
  const variants = useQuery({
    queryKey: ['variants', artifactId],
    queryFn: () => apiFetch<Artifact[]>(`/artifacts/${artifactId}/variants`),
    // Sibling jobs are still running: keep the grid honest until every row is terminal.
    refetchInterval: (query) => (query.state.data?.some((v) => LIVE.has(v.status)) ? pollMs : false),
  })
  const rows = (variants.data ?? []).map((v) => (current && v.id === current.id ? { ...v, ...current } : v))
  if (rows.length < 2) return null

  return (
    <section className="flex flex-col gap-2">
      <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
        <span className="text-accent">•</span> Options from this brief
      </p>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((variant, index) => {
          const preview = variant.pages?.[0] ?? variant.export_urls?.png ?? variant.export_urls?.jpg
          return (
            <Link
              key={variant.id}
              href={`/artifacts/${variant.id}`}
              aria-current={variant.id === artifactId ? 'page' : undefined}
              className={`flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-3 text-sm transition hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                variant.id === artifactId ? 'ring-2 ring-accent' : ''
              }`}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="aspect-square w-full rounded-lg object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-lg bg-bg-inset" />
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-text">
                  Option {index + 1}
                  {variant.version > 1 && (
                    <span className="ml-1.5 font-mono text-[11px] text-text-muted">v{variant.version}</span>
                  )}
                </span>
                <StatusBadge status={variant.status} />
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
