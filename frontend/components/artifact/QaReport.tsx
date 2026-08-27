'use client'
import type { ArtifactStatus, QaReport } from '@/lib/types'
import { Button } from '@/components/ui/Button'

const CHECK_LABELS: Record<string, string> = {
  structure: 'File structure',
  overflow: 'Text overflow',
  bounds: 'Elements inside the canvas',
  tokens: 'Unbroken prices, dates and identifiers',
  fill: 'Dead space',
  palette: 'Brand palette',
  fonts: 'Brand fonts actually rendered',
  determinism: 'Two identical builds match',
  qa_pipeline: 'QA pipeline',
}

export function QaReportPanel({
  report,
  status,
  onRerun,
  onSelectPage,
}: {
  report: QaReport | Record<string, never>
  status: ArtifactStatus
  onRerun: () => void
  // Human QA correlation: a finding that names a page can switch the viewer to it.
  onSelectPage?: (pageIndex: number) => void
}) {
  if (!('passed' in report)) {
    return <p className="text-sm text-text-muted">Quality checks have not run yet.</p>
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className={report.passed ? 'text-success' : 'text-warning'}>•</span> 04 QA
          </p>
          <h2 className="mt-1 text-base font-medium text-text">
            Quality checks {report.passed ? 'passed' : 'failed'}
          </h2>
        </div>
        <Button variant="ghost" onClick={onRerun}>
          Re-run checks
        </Button>
      </div>

      {report.findings.length === 0 && (
        <p className="text-sm text-text-muted">Nothing to fix. {report.checks_run.length} checks ran.</p>
      )}

      <ul className="flex flex-col gap-2">
        {report.findings.map((finding, index) => (
          <li
            key={index}
            className={`rounded-lg border-l-4 px-3 py-2 text-sm ${
              finding.severity === 'error' ? 'border-danger bg-danger/10' : 'border-warning bg-warning/10'
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-text">{CHECK_LABELS[finding.check] ?? finding.check}</span>
              {finding.page !== null &&
                (onSelectPage ? (
                  <button
                    type="button"
                    onClick={() => onSelectPage(finding.page! - 1)}
                    aria-label={`Show page ${finding.page}`}
                    className="rounded-full bg-bg-inset px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest text-text-muted hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    page {finding.page}
                  </button>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    page {finding.page}
                  </span>
                ))}
            </div>
            {/* Backend detail is shown verbatim. */}
            <p className="mt-1 text-text-muted">{finding.detail}</p>
          </li>
        ))}
      </ul>

      {report.skipped.length > 0 && (
        <p className="text-xs text-text-muted">
          Not run for this artifact: {report.skipped.map((c) => CHECK_LABELS[c] ?? c).join(', ')}.
        </p>
      )}

      {status === 'qa_failed' && (
        <p className="text-xs text-text-muted">
          Iterate below to fix these, or re-run the checks after changing DESIGN.md.
        </p>
      )}
    </section>
  )
}
