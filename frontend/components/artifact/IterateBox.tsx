'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import type { Artifact } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { JobProgress } from '@/components/generate/JobProgress'

export function IterateBox({ artifactId }: { artifactId: string }) {
  const queryClient = useQueryClient()
  const [instruction, setInstruction] = useState('')
  const [child, setChild] = useState<Artifact | null>(null)

  const iterate = useMutation({
    mutationFn: () =>
      apiFetch<Artifact>(`/artifacts/${artifactId}/iterate`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      }),
    onSuccess: (created) => {
      setChild(created)
      setInstruction('')
      // A new version exists: every surface that lists versions or options is stale.
      queryClient.invalidateQueries({ queryKey: ['lineage'] })
      queryClient.invalidateQueries({ queryKey: ['variants'] })
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Iterate
        </p>
        <h2 className="mt-1 text-base font-medium text-text">Request an edit</h2>
      </div>
      <ErrorBanner error={iterate.error} />
      <Field label="What should change?" hint="Every edit creates a new version. Nothing is overwritten.">
        <textarea
          aria-label="What should change?"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          className="rounded-lg border border-border bg-bg-inset p-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </Field>
      <div>
        <Button onClick={() => iterate.mutate()} disabled={!instruction.trim() || iterate.isPending}>
          {iterate.isPending ? 'Applying…' : 'Apply edit'} <span aria-hidden="true">→</span>
        </Button>
      </div>
      {child && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text">
            Created{' '}
            <Link href={`/artifacts/${child.id}`} className="text-accent underline underline-offset-4">
              version {child.version}
            </Link>
            .
          </p>
          <JobProgress artifactId={child.id} />
        </div>
      )}
    </section>
  )
}
