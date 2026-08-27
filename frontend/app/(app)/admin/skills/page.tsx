'use client'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ArtifactType, Me, Skill } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

// PRD 6.4: `image` is deliberately absent. A skill works by instructing a
// coding agent, and image-mode has none. The backend refuses it too — this
// list is the affordance, not the enforcement.
const SCOPES: ArtifactType[] = ['social_post', 'carousel', 'deck', 'single_pager']

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent'

export default function SkillsPage() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ArtifactType[]>([])

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const isAdmin = me.data?.role === 'admin'
  const skills = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiFetch<Skill[]>('/skills'),
    enabled: isAdmin,
  })

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a SKILL.md first')
      const body = new FormData()
      body.append('file', file)
      body.append('name', name.trim())
      body.append('applies_to', scopes.join(','))
      return apiFetch<Skill>('/skills', { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      setName('')
      setScopes([])
      queryClient.invalidateQueries({ queryKey: ['skills'] })
    },
  })

  const toggle = useMutation({
    mutationFn: (skill: Skill) =>
      apiFetch<Skill>(`/skills/${skill.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !skill.enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  if (me.isLoading) return <Spinner />
  if (!isAdmin) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">
        Skills are admin only.
      </p>
    )
  }

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Admin
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">Skills</h1>
      </div>
      <ErrorBanner error={upload.error ?? toggle.error ?? skills.error} />

      <form
        className="flex flex-col gap-4 rounded-xl border border-border bg-bg-elevated p-4"
        onSubmit={(e) => {
          e.preventDefault()
          upload.mutate()
        }}
      >
        <div>
          <h2 className="text-base font-medium text-text">Upload a skill</h2>
          <p className="mt-1 text-sm text-text-muted">
            A SKILL.md is read by the coding agent while it generates. Images have no coding agent
            in the loop, so image is not an option here.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Name">
            <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="SKILL.md">
            <input
              ref={fileRef}
              type="file"
              accept=".md"
              className="text-sm text-text-muted file:mr-3 file:rounded-full file:border file:border-border file:bg-bg-elevated file:px-3 file:py-1 file:text-sm file:text-text"
            />
          </Field>
        </div>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-2 font-mono text-[11px] uppercase tracking-widest text-text-muted">
            Applies to
          </legend>
          {SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 font-mono text-xs text-text">
              <input
                type="checkbox"
                aria-label={scope}
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes(e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope))
                }
                className="accent-accent focus-visible:ring-2 focus-visible:ring-accent"
              />
              {scope}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={!name.trim() || scopes.length === 0 || upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </form>

      {skills.isLoading && <Spinner />}
      {skills.data?.length === 0 && (
        <EmptyState title="No skills yet" hint="Upload a SKILL.md and choose which artifact types it applies to." />
      )}
      {skills.data && skills.data.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
          {skills.data.map((skill) => (
            <li key={skill.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-text">{skill.name}</span>
                <span className="font-mono text-[11px] tracking-widest text-text-muted">
                  {skill.applies_to.join(', ')}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] tracking-widest uppercase ${
                    skill.enabled ? 'bg-success/15 text-success' : 'bg-text-muted/15 text-text-muted'
                  }`}
                >
                  <span aria-hidden="true">•</span> {skill.enabled ? 'enabled' : 'disabled'}
                </span>
              </span>
              <Button variant="ghost" onClick={() => toggle.mutate(skill)} disabled={toggle.isPending}>
                {skill.enabled ? 'Disable' : 'Enable'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
