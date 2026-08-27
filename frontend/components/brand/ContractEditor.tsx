'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Contract } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const COPY = {
  design: {
    title: 'DESIGN.md',
    hint: 'Palette, type scale, spacing rhythm, component conventions, layout principles. Hex values written here are what the QA palette check enforces.',
  },
  voice: {
    title: 'VOICE.md',
    hint: 'What the brand sounds like, what it never says, claim-substantiation rules, banned AI-tell patterns. Copy generation refuses to run without this.',
  },
} as const

// Plain-markdown editor for a brand contract. No wizard (PRD §2): admins paste
// the content directly; members read only.
export function ContractEditor({
  brandId,
  kind,
  readOnly,
}: {
  brandId: string
  kind: 'design' | 'voice'
  readOnly: boolean
}) {
  const queryClient = useQueryClient()
  const key = ['contract', brandId, kind]
  const [draft, setDraft] = useState<string | null>(null)

  const contract = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<Contract>(`/brands/${brandId}/${kind}`),
  })

  useEffect(() => {
    if (contract.data && draft === null) setDraft(contract.data.content)
  }, [contract.data, draft])

  const save = useMutation({
    mutationFn: (content: string) =>
      apiFetch<Contract>(`/brands/${brandId}/${kind}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    onSuccess: (updated) => {
      setDraft(updated.content)
      queryClient.setQueryData(key, updated)
    },
  })

  if (contract.error) return <ErrorBanner error={contract.error} />
  if (contract.isLoading || draft === null) return <Spinner />
  const dirty = draft !== contract.data?.content
  const version = contract.data?.version ?? 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> Contract
          </p>
          <h1 className="mt-2 font-display text-4xl text-text">{COPY[kind].title}</h1>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          {version === 0 ? 'not written yet' : `version ${version}`}
        </span>
      </div>
      <p className="text-sm text-text-muted">{COPY[kind].hint}</p>
      <ErrorBanner error={save.error} />
      <textarea
        aria-label={COPY[kind].title}
        value={draft}
        disabled={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={28}
        className="w-full rounded-lg border border-border bg-bg-inset p-3 font-mono text-sm leading-relaxed text-text outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
      />
      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {dirty && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-warning">
              Unsaved changes
            </span>
          )}
        </div>
      )}
    </section>
  )
}
