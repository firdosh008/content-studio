'use client'
/* eslint-disable @next/next/no-img-element */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Reference } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

// PRD §4.3 expectation-setting. Shown whether or not the library has anything
// in it — the empty state is exactly when a new admin needs to read it.
function Expectation() {
  return (
    <p className="text-xs text-text-muted">
      References produce consistent brand feel, not pixel-exact template reproduction. Anything that
      must be identical every run does not belong here.
    </p>
  )
}

export function ReferenceGrid({ brandId, readOnly }: { brandId: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const references = useQuery({
    queryKey: ['references', brandId],
    queryFn: () => apiFetch<Reference[]>(`/brands/${brandId}/references`),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/references/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['references', brandId] }),
  })

  if (references.isLoading) return <Spinner />
  if (references.error) return <ErrorBanner error={references.error} />

  return (
    <section className="flex flex-col gap-3">
      <Expectation />
      <ErrorBanner error={remove.error} />
      {references.data?.length === 0 ? (
        <EmptyState
          title="No references yet"
          hint="Upload screenshots and .pptx files, then tag their scope and role."
        />
      ) : (
        <ul className="grid grid-cols-3 gap-4">
          {references.data?.map((reference) => (
            <li
              key={reference.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-3"
            >
              {reference.file_type === 'image' && reference.url ? (
                <img src={reference.url} alt="" className="h-32 w-full rounded-lg object-cover" />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-lg bg-bg-inset font-mono text-[11px] tracking-widest text-text-muted uppercase">
                  PPTX
                </div>
              )}
              <div className="flex flex-wrap gap-1 font-mono text-[11px] tracking-widest uppercase">
                <span className="rounded-full bg-accent px-2.5 py-0.5 text-accent-fg">{reference.scope}</span>
                <span className="rounded-full bg-text-muted/15 px-2.5 py-0.5 text-text-muted">
                  {reference.role.replace('_', ' ')}
                </span>
              </div>
              {reference.extracted_layout_spec && (
                <span className="font-mono text-[11px] tracking-widest text-success uppercase">
                  <span aria-hidden="true">•</span> Layout spec extracted
                </span>
              )}
              {!readOnly && (
                <Button
                  variant="ghost"
                  onClick={() => remove.mutate(reference.id)}
                  disabled={remove.isPending}
                  className="self-start"
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
