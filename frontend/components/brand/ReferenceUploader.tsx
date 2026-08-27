'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Reference, ReferenceRole, ReferenceScope } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const SCOPES: ReferenceScope[] = ['social', 'presentation', 'both']
const ROLES: ReferenceRole[] = ['layout', 'typography', 'colour_gradient', 'overall_vibe']

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function ReferenceUploader({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<ReferenceScope>('social')
  const [role, setRole] = useState<ReferenceRole>('layout')

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a file first')
      const body = new FormData()
      body.append('file', file)
      body.append('scope', scope)
      body.append('role', role)
      return apiFetch<Reference>(`/brands/${brandId}/references`, { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['references', brandId] })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Add a reference
        </p>
      </div>
      <p className="text-sm text-text-muted">
        Tag it, don&apos;t describe it. The agent reads the image at generation time; the tags decide
        which generations it reaches. A .pptx is parsed into a layout spec on upload.
      </p>
      <ErrorBanner error={upload.error} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="File">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pptx"
            className="text-sm text-text-muted file:mr-3 file:rounded-full file:border file:border-border file:bg-bg-elevated file:px-3 file:py-1 file:text-sm file:text-text"
          />
        </Field>
        <Field label="Scope" hint="Which generations may see it.">
          <select
            aria-label="Scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ReferenceScope)}
            className={inputClass}
          >
            {SCOPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" hint="What to take from it.">
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as ReferenceRole)}
            className={inputClass}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
    </section>
  )
}
