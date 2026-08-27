'use client'
import { use, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { Brief, ResearchPrefill } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

export default function NewBriefPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const router = useRouter()
  const [content, setContent] = useState('')
  const [question, setQuestion] = useState('')
  const [runId, setRunId] = useState<string | null>(null)

  // Returns a non-persisted prefill. Nothing is created here — one pull never
  // yields a brief row; the only POST /briefs is on Save.
  const pull = useMutation({
    mutationFn: () =>
      apiFetch<ResearchPrefill>('/briefs/from-research', {
        method: 'POST',
        body: JSON.stringify({ brand_id: brandId, query: question }),
      }),
    onSuccess: (prefill) => {
      // PRD 5.1: pre-fill for the member to edit. Never proceed automatically.
      setContent(prefill.content)
      setRunId(prefill.research_run_id)
    },
  })

  const save = useMutation({
    mutationFn: () =>
      apiFetch<Brief>('/briefs', {
        method: 'POST',
        body: JSON.stringify({
          brand_id: brandId,
          content,
          source: runId ? 'research_agent' : 'manual',
          research_run_id: runId,
        }),
      }),
    onSuccess: (brief) => router.push(`/briefs/${brief.id}`),
  })

  return (
    <section className="flex max-w-4xl flex-col gap-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> 01 Brief
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">New brief</h1>
      </div>
      <ErrorBanner error={pull.error ?? save.error} />

      <div className="rounded-xl border border-border bg-bg-elevated p-4">
        <Field
          label="Research question"
          hint="Optional. Pulls a thesis from the research agent to pre-fill the brief below."
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="What should this piece argue?"
          />
        </Field>
        <Button
          variant="ghost"
          className="mt-3"
          onClick={() => pull.mutate()}
          disabled={!question.trim() || pull.isPending}
        >
          {pull.isPending ? 'Researching…' : 'Pull from research'}
        </Button>
      </div>

      <Field label="Brief" hint="What this piece is for, who it is for, what it must say.">
        <textarea
          aria-label="Brief"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="rounded-lg border border-border bg-bg-inset p-3 text-sm leading-relaxed text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </Field>

      {runId && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-warning">
          Pre-filled from research run {runId}. Edit before saving.
        </p>
      )}

      <div>
        <Button onClick={() => save.mutate()} disabled={!content.trim() || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save brief'} <span aria-hidden="true">→</span>
        </Button>
      </div>
    </section>
  )
}
