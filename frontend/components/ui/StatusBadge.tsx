import type { ArtifactStatus, CopyStatus } from '@/lib/types'

const LABELS: Record<string, string> = {
  queued: 'Queued',
  generating: 'Generating',
  ready: 'Ready',
  qa_failed: 'QA failed',
  in_review: 'In review',
  approved: 'Approved',
  failed: 'Failed',
  draft: 'Draft',
}

// Dot-indicator pills: translucent tint of the semantic colour, semantic colour as text.
// generating = coral, approved/ready = green, qa_failed/draft/in_review = amber, failed = red, queued = muted.
const TONES: Record<string, string> = {
  queued: 'bg-text-muted/15 text-text-muted',
  generating: 'bg-accent/15 text-accent',
  ready: 'bg-success/15 text-success',
  qa_failed: 'bg-warning/15 text-warning',
  in_review: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  failed: 'bg-danger/15 text-danger',
  draft: 'bg-warning/15 text-warning',
}

export function StatusBadge({ status }: { status: ArtifactStatus | CopyStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[status] ?? 'bg-text-muted/15 text-text-muted'}`}
    >
      <span aria-hidden="true">•</span>
      {LABELS[status] ?? status}
    </span>
  )
}
