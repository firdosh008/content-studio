'use client'
/* eslint-disable @next/next/no-img-element */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Asset } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export function AssetGrid({ brandId, readOnly }: { brandId: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const assets = useQuery({
    queryKey: ['assets', brandId],
    queryFn: () => apiFetch<Asset[]>(`/brands/${brandId}/assets`),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets', brandId] }),
  })

  if (assets.isLoading) return <Spinner />
  if (assets.error) return <ErrorBanner error={assets.error} />
  const fonts = (assets.data ?? []).filter((a) => a.asset_type === 'font')
  const files = (assets.data ?? []).filter((a) => a.asset_type !== 'font')

  return (
    <div className="flex flex-col gap-6">
      <ErrorBanner error={remove.error} />

      {/* Fonts first: they are P0 (PRD 4.4) and their absence is a silent failure. */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Fonts
        </h2>
        {fonts.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            No brand fonts uploaded. Generation will fall back to whatever the container happens to
            have, and the font QA check will fail.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {fonts.map((font) => (
              <li
                key={font.id}
                className="flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-3 py-1 font-mono text-xs text-text"
              >
                <span>{font.label}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(font.id)}
                    aria-label={`Remove ${font.label}`}
                    className="text-text-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Logos and images
        </h2>
        {files.length === 0 ? (
          <EmptyState
            title="No logos or images yet"
            hint="Upload the real logo files, headshots, screenshots and icons the artifacts should use."
          />
        ) : (
          <ul className="grid grid-cols-4 gap-4">
            {files.map((asset) => (
              <li
                key={asset.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-3"
              >
                {asset.url ? (
                  <img src={asset.url} alt={asset.label} className="h-24 w-full rounded-lg object-contain" />
                ) : (
                  <div className="h-24 w-full rounded-lg bg-bg-inset" />
                )}
                <span className="text-xs text-text">{asset.label}</span>
                <span className="font-mono text-[11px] tracking-widest text-text-muted uppercase">
                  {asset.asset_type}
                </span>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    onClick={() => remove.mutate(asset.id)}
                    disabled={remove.isPending}
                    className="self-start"
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
