'use client'
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import type { Artifact } from '@/lib/types'

// Per-page raster URLs: `pages` when the backend sends it, else per-page
// export entries (png_1, png_2, ... or page_1 ...), else the single png/jpg.
export function artifactPages(artifact: Artifact): string[] {
  if (artifact.pages && artifact.pages.length > 0) return artifact.pages
  const perPage = Object.entries(artifact.export_urls ?? {})
    .map(([key, url]) => {
      const match = key.match(/^(?:png|jpg|jpeg|page)[_-](\d+)$/i)
      return match ? { index: Number(match[1]), url } : null
    })
    .filter((entry): entry is { index: number; url: string } => entry !== null)
    .sort((a, b) => a.index - b.index)
  if (perPage.length > 0) return perPage.map((entry) => entry.url)
  const single = artifact.export_urls?.png ?? artifact.export_urls?.jpg
  return single ? [single] : []
}

/**
 * Human QA needs pages (PRD §6.1): a carousel or deck is reviewed page by page,
 * never from a single image. Thumbnail strip + main view, prev/next, a
 * counter, click-to-zoom, and a controlled `page` so a QA finding can select it.
 */
export function ArtifactViewer({
  artifact,
  page,
  onPageChange,
}: {
  artifact: Artifact
  page: number
  onPageChange: (page: number) => void
}) {
  const pages = artifactPages(artifact)
  const [zoomed, setZoomed] = useState(false)
  const total = pages.length
  const index = Math.max(0, Math.min(page, total - 1))

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-muted">
        No preview yet.
      </div>
    )
  }

  const label = `${artifact.artifact_type.replace('_', ' ')} v${artifact.version}, page ${index + 1} of ${total}`
  const multi = total > 1

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label="Zoom in"
          className="block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <img src={pages[index]} alt={label} className="w-full" />
        </button>
        {multi && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onPageChange(index - 1)}
              disabled={index === 0}
              aria-label="Previous page"
              className="rounded-full border border-border px-3 py-1 text-sm text-text hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-40"
            >
              ←
            </button>
            <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(index + 1)}
              disabled={index === total - 1}
              aria-label="Next page"
              className="rounded-full border border-border px-3 py-1 text-sm text-text hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-40"
            >
              →
            </button>
          </div>
        )}
      </div>

      {multi && (
        <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Pages">
          {pages.map((url, i) => (
            <li key={url + i} className="shrink-0">
              <button
                type="button"
                onClick={() => onPageChange(i)}
                aria-label={`Page ${i + 1} of ${total}`}
                aria-current={i === index ? 'true' : undefined}
                className={`block h-16 w-16 overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  i === index ? 'border-accent ring-2 ring-accent' : 'border-border opacity-70 hover:opacity-100'
                }`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {zoomed && (
        <div
          role="dialog"
          aria-label={`Full size, ${label}`}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center overflow-auto bg-bg/95 p-6"
          onClick={() => setZoomed(false)}
        >
          <img src={pages[index]} alt="" className="max-h-none max-w-none" />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="fixed top-4 right-4 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
