'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Brief } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const newBriefClass =
  'inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-[0_0_24px_rgba(232,84,58,0.25)] transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

export default function BriefsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const briefs = useQuery({
    queryKey: ['briefs', brandId],
    queryFn: () => apiFetch<Brief[]>(`/briefs?brand_id=${brandId}`),
  })

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
      <NavLinks brandId={brandId} />
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
              <span className="text-accent">•</span> 01 Brief
            </p>
            <h1 className="mt-2 font-display text-4xl text-text">Briefs</h1>
          </div>
          <Link href={`/brands/${brandId}/briefs/new`} className={newBriefClass}>
            New brief <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ErrorBanner error={briefs.error} />
        {briefs.isLoading && <Spinner />}
        {briefs.data?.length === 0 && (
          <EmptyState
            title="No briefs yet"
            hint="A brief says what the piece is for, who it is for and what it must say."
            action={
              <Link href={`/brands/${brandId}/briefs/new`} className={newBriefClass}>
                New brief <span aria-hidden="true">→</span>
              </Link>
            }
          />
        )}
        {briefs.data && briefs.data.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
            {briefs.data.map((brief) => (
              <li key={brief.id} className="flex items-baseline gap-3 px-4 py-3">
                <Link
                  href={`/briefs/${brief.id}`}
                  className="text-sm text-text hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {brief.content.slice(0, 90) || 'Untitled brief'}
                </Link>
                {brief.source === 'research_agent' && (
                  <span className="rounded-full bg-text-muted/15 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    from research
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
