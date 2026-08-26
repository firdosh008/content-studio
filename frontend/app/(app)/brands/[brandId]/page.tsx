'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Brand, Contract } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function BrandOverview({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const brand = useQuery({
    queryKey: ['brand', brandId],
    queryFn: () => apiFetch<Brand>(`/brands/${brandId}`),
  })
  const design = useQuery({
    queryKey: ['design', brandId],
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/design`),
  })
  const voice = useQuery({
    queryKey: ['voice', brandId],
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/voice`),
  })

  if (brand.isLoading) return <Spinner />

  // PRD §12: mediocre contracts produce mediocre output regardless of engine.
  // The overview says plainly whether this brand is ready to generate.
  const designMissing = (design.data?.version ?? 0) === 0
  const voiceMissing = (voice.data?.version ?? 0) === 0
  const ready = design.isSuccess && voice.isSuccess && !designMissing && !voiceMissing

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
      <NavLinks brandId={brandId} />
      <section className="flex flex-col gap-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> Overview
          </p>
          <h1 className="mt-2 font-display text-4xl text-text">{brand.data?.name}</h1>
        </div>
        <ErrorBanner error={brand.error ?? design.error ?? voice.error} />

        {design.isSuccess && voice.isSuccess && !ready && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            This brand is not ready to generate.{' '}
            {designMissing && (
              <Link href={`/brands/${brandId}/design`} className="underline">
                Write DESIGN.md
              </Link>
            )}
            {designMissing && voiceMissing && ' and '}
            {voiceMissing && (
              <Link href={`/brands/${brandId}/voice`} className="underline">
                write VOICE.md
              </Link>
            )}
            .
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3">
          {(
            [
              ['DESIGN.md', design.data],
              ['VOICE.md', voice.data],
            ] as const
          ).map(([label, contract]) => (
            <div key={label} className="rounded-xl border border-border bg-bg-elevated p-4">
              <dt className="font-mono text-[11px] uppercase tracking-widest text-text-muted">{label}</dt>
              <dd className="mt-1 text-sm text-text">
                {contract && contract.version > 0 ? `version ${contract.version}` : 'not written yet'}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          href={`/brands/${brandId}/briefs/new`}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-[0_0_24px_rgba(232,84,58,0.25)] transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          Start a brief <span aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  )
}
