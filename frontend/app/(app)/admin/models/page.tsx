'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me, Provider, ProviderType } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent'

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [type, setType] = useState<ProviderType>('coding_agent')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const isAdmin = me.data?.role === 'admin'
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers'),
    enabled: isAdmin,
  })

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Provider>('/providers', {
        method: 'POST',
        body: JSON.stringify({ type, name: name.trim(), api_key: apiKey }),
      }),
    onSuccess: () => {
      // The key is never held after submit and the API never returns it.
      setName('')
      setApiKey('')
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })

  const toggle = useMutation({
    mutationFn: (provider: Provider) =>
      apiFetch<Provider>(`/providers/${provider.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !provider.enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })

  if (me.isLoading) return <Spinner />
  if (!isAdmin) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">
        Models are admin only.
      </p>
    )
  }

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Admin
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">Models</h1>
        <p className="mt-2 text-sm text-text-muted">
          Coding agents write code-mode artifacts and copy; image providers render image-mode
          artifacts. Keys are encrypted by the backend and never shown again.
        </p>
      </div>
      <ErrorBanner error={create.error ?? toggle.error ?? providers.error} />

      <form
        className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-bg-elevated p-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field label="Kind">
          <select
            aria-label="Kind"
            value={type}
            onChange={(e) => setType(e.target.value as ProviderType)}
            className={inputClass}
          >
            <option value="coding_agent">coding agent</option>
            <option value="image_provider">image provider</option>
          </select>
        </Field>
        <Field label="Name" hint="As open-design expects it, e.g. claude, kimi, gpt-image-2.">
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="API key" hint="Encrypted on save. Never shown again.">
          <input
            aria-label="API key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={!name.trim() || !apiKey || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add'}
        </Button>
      </form>

      {providers.isLoading && <Spinner />}
      {providers.data?.length === 0 && (
        <EmptyState title="No models yet" hint="Add a coding agent to generate copy and code-mode artifacts." />
      )}
      {providers.data && providers.data.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
          {providers.data.map((provider) => (
            <li key={provider.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="flex items-center gap-3">
                <span className="text-text">{provider.name}</span>
                <span className="font-mono text-[11px] tracking-widest text-text-muted uppercase">
                  {provider.type.replace('_', ' ')}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] tracking-widest uppercase ${
                    provider.enabled ? 'bg-success/15 text-success' : 'bg-text-muted/15 text-text-muted'
                  }`}
                >
                  <span aria-hidden="true">•</span> {provider.enabled ? 'enabled' : 'disabled'}
                </span>
              </span>
              <Button variant="ghost" onClick={() => toggle.mutate(provider)} disabled={toggle.isPending}>
                {provider.enabled ? 'Disable' : 'Enable'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
