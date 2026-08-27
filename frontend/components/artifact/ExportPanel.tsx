'use client'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const EXPORTABLE = ['ready', 'in_review', 'approved']

// Every download link — the carousel ZIP included — comes only from the API's
// exports response as a signed URL. The panel renders whatever formats come
// back; it never hand-builds URLs or decides which formats are allowed.
export function ExportPanel({ artifact }: { artifact: Artifact }) {
  const exportable = EXPORTABLE.includes(artifact.status)
  const exports = useQuery({
    queryKey: ['exports', artifact.id, artifact.version, artifact.status],
    queryFn: () => apiFetch<Record<string, string>>(`/artifacts/${artifact.id}/exports`),
    enabled: exportable,
  })

  if (!exportable) {
    return <p className="text-sm text-text-muted">Nothing to export yet.</p>
  }

  const entries = Object.entries(exports.data ?? {})

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> 06 Export
        </p>
        <h2 className="mt-1 text-base font-medium text-text">Download</h2>
      </div>
      <ErrorBanner error={exports.error} />
      {exports.isLoading && <Spinner label="Preparing exports" />}
      {exports.isSuccess && entries.length === 0 && (
        <p className="text-sm text-text-muted">No export formats are available for this artifact.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {entries.map(([format, url]) => (
          <a
            key={format}
            href={url}
            className="rounded-full border border-border bg-bg-elevated px-3.5 py-1.5 text-sm text-text transition hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {format === 'zip' && artifact.artifact_type === 'carousel'
              ? 'Download all cards (ZIP)'
              : `Download ${format.toUpperCase()}`}{' '}
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
      {artifact.status !== 'approved' && (
        <p className="text-xs text-text-muted">
          These are working exports. An artifact must be approved before a final export.
        </p>
      )}
    </section>
  )
}
