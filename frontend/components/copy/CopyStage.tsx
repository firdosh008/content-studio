'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Brief, Copy, Me, Provider } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { StatusBadge } from '@/components/ui/StatusBadge'

type Mode = 'write' | 'generate'

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function CopyStage({
  brief,
  copy,
  onApproved,
  onChange,
}: {
  brief: Brief
  copy?: Copy
  onApproved: (copy: Copy) => void
  // Fires on every server-confirmed change (create, update, approve) so the
  // owner can keep its copy query in sync. Approval also fires onApproved.
  onChange?: (copy: Copy) => void
}) {
  const [mode, setMode] = useState<Mode>('write')
  const [text, setText] = useState(copy?.content ?? '')
  const [modelId, setModelId] = useState('')
  const [current, setCurrent] = useState<Copy | undefined>(copy)

  // The owner may deliver the copy later (server query resolving after mount,
  // or a reopened tab). Adopt it whenever a different server version arrives.
  useEffect(() => {
    if (!copy) return
    if (current && current.id === copy.id && current.version === copy.version && current.status === copy.status) return
    setCurrent(copy)
    setText(copy.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copy])

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers'),
  })
  const codingAgents = (providers.data ?? []).filter((p) => p.type === 'coding_agent' && p.enabled)

  function adopt(next: Copy) {
    setCurrent(next)
    setText(next.content)
    onChange?.(next)
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Copy>(`/briefs/${brief.id}/copy`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: adopt,
  })

  const update = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Copy>(`/copy/${id}`, { method: 'PATCH', body: JSON.stringify({ content: text }) }),
    onSuccess: adopt,
  })

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch<Copy>(`/copy/${id}/approve`, { method: 'POST' }),
    onSuccess: (approvedCopy) => {
      adopt(approvedCopy)
      onApproved(approvedCopy)
    },
  })

  const isAdmin = me.data?.role === 'admin'
  const dirty = current !== undefined && text !== current.content

  return (
    <section className="flex flex-col gap-4" aria-label="Copy stage">
      <div className="flex items-center gap-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> 02 Copy
        </p>
        {current && <StatusBadge status={current.status} />}
        {current && (
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            v{current.version}
          </span>
        )}
      </div>
      <h2 className="font-display text-3xl text-text">
        Copy
      </h2>

      <p className="text-sm text-text-muted">
        Copy is approved before design begins. The design agent consumes it; it does not write it.
      </p>

      {/* Both paths are peers. PRD 5.2 is explicit that hand-written copy is
          first-class, so it is the default tab and not tucked behind a link. */}
      <div role="tablist" aria-label="How to produce copy" className="flex gap-2">
        {(['write', 'generate'] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              mode === value
                ? 'bg-accent text-accent-fg'
                : 'border border-border bg-bg-elevated text-text-muted hover:bg-bg-inset hover:text-text'
            }`}
          >
            {value === 'write' ? 'Write it' : 'Generate from VOICE.md'}
          </button>
        ))}
      </div>

      <ErrorBanner error={create.error ?? update.error ?? approve.error} />

      {mode === 'generate' && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-elevated p-4">
          <Field label="Model">
            <select
              aria-label="Model"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a model</option>
              {codingAgents.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            onClick={() => create.mutate({ generate: true, model_provider_id: modelId })}
            disabled={!modelId || create.isPending}
          >
            {create.isPending ? 'Generating…' : 'Generate copy'}
          </Button>
          {codingAgents.length === 0 && (
            <span className="text-xs text-text-muted">
              No coding-agent model enabled. An admin can add one under Models.
            </span>
          )}
        </div>
      )}

      <Field label="Copy">
        <textarea
          aria-label="Copy"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          className={`${inputClass} p-3 leading-relaxed`}
        />
      </Field>

      {dirty && current?.status === 'approved' && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Saving will return this copy to draft and it will need approval again.
        </p>
      )}

      <div className="flex gap-3">
        {!current && (
          <Button
            onClick={() => create.mutate({ generate: false, content: text })}
            disabled={!text.trim() || create.isPending}
          >
            {create.isPending ? 'Saving…' : 'Save copy'}
          </Button>
        )}
        {current && (
          <Button
            variant="ghost"
            onClick={() => update.mutate(current.id)}
            disabled={!dirty || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
        {current && isAdmin && current.status !== 'approved' && (
          <Button onClick={() => approve.mutate(current.id)} disabled={dirty || approve.isPending}>
            {approve.isPending ? 'Approving…' : 'Approve copy'} <span aria-hidden="true">→</span>
          </Button>
        )}
      </div>
    </section>
  )
}
