'use client'
import { use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { ApiError, apiFetch } from '@/lib/api'
import type { Brief, Copy } from '@/lib/types'
import { CopyStage } from '@/components/copy/CopyStage'
import { GenerateForm } from '@/components/generate/GenerateForm'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function BriefPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = use(params)
  const queryClient = useQueryClient()
  const copyKey = ['copy', briefId]

  const brief = useQuery({
    queryKey: ['brief', briefId],
    queryFn: () => apiFetch<Brief>(`/briefs/${briefId}`),
  })

  // PRD 7.1 — reload recovery: the current copy and the Design unlock come from
  // the server, never from local state, so a reopened tab is correct immediately.
  const copy = useQuery({
    queryKey: copyKey,
    queryFn: async () => {
      try {
        return await apiFetch<Copy>(`/briefs/${briefId}/copy`)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null // no copy yet
        throw error
      }
    },
  })

  const syncCopy = (next: Copy) => queryClient.setQueryData(copyKey, next)

  if (brief.isLoading || copy.isLoading) return <Spinner />
  if (!brief.data) return <ErrorBanner error={brief.error ?? 'Brief not found'} />

  const approved = copy.data?.status === 'approved' ? copy.data : null

  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <section>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> 01 Brief
          <span className="mx-2 text-border">·</span>
          <Link href={`/brands/${brief.data.brand_id}/briefs`} className="hover:text-text">
            All briefs
          </Link>
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">Brief</h1>
        <p className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-bg-elevated p-4 text-sm leading-relaxed text-text">
          {brief.data.content}
        </p>
        {brief.data.source === 'research_agent' && brief.data.research_run_id && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-text-muted">
            from research run {brief.data.research_run_id}
          </p>
        )}
      </section>

      <ErrorBanner error={copy.error} />

      <CopyStage
        brief={brief.data}
        copy={copy.data ?? undefined}
        onChange={syncCopy}
        onApproved={syncCopy}
      />

      {approved ? (
        <GenerateForm brandId={brief.data.brand_id} briefId={brief.data.id} copyId={approved.id} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
          <span className="mr-2 font-mono text-[11px] uppercase tracking-widest">03 Design</span>
          Design unlocks once the copy is approved.
        </p>
      )}
    </div>
  )
}
