'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { Artifact, ArtifactType, GenerationMode, Provider } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { JobProgress } from '@/components/generate/JobProgress'

// Exactly the five artifact types (PRD §2). No document types, ever.
const TYPES: { value: ArtifactType; label: string; mode: GenerationMode }[] = [
  { value: 'social_post', label: 'Social post', mode: 'code' },
  { value: 'carousel', label: 'Carousel', mode: 'code' },
  { value: 'deck', label: 'Deck', mode: 'code' },
  { value: 'single_pager', label: 'Single-pager', mode: 'code' },
  { value: 'image', label: 'Image', mode: 'image' },
]

const MAX_VARIANTS = 8

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function GenerateForm({
  brandId,
  briefId,
  copyId,
}: {
  brandId: string
  briefId: string
  copyId: string
}) {
  const router = useRouter()
  const [artifactType, setArtifactType] = useState<ArtifactType>('carousel')
  const [modelId, setModelId] = useState('')
  const [variants, setVariants] = useState(1)
  const [created, setCreated] = useState<Artifact[]>([])

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiFetch<Provider[]>('/providers'),
  })

  const mode = TYPES.find((t) => t.value === artifactType)?.mode ?? 'code'
  const wantedType = mode === 'image' ? 'image_provider' : 'coding_agent'
  const options = (providers.data ?? []).filter((p) => p.enabled && p.type === wantedType)

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<Artifact[]>('/artifacts', {
        method: 'POST',
        body: JSON.stringify({
          brand_id: brandId,
          brief_id: briefId,
          copy_id: copyId,
          artifact_type: artifactType,
          model_provider_id: modelId,
          variants,
        }),
      }),
    onSuccess: (artifacts) => {
      // A single artifact: the artifact page owns the progress from here, so a
      // reload lands somewhere durable. N variants: keep the inline list; the
      // brand's Artifacts list (Phase 8) is the durable discovery path.
      if (artifacts.length === 1) {
        router.push(`/artifacts/${artifacts[0].id}`)
        return
      }
      setCreated(artifacts)
    },
  })

  return (
    <section aria-label="Design" className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> 03 Design
        </p>
        <h2 className="mt-2 font-display text-3xl text-text">Generate</h2>
      </div>
      <ErrorBanner error={generate.error} />

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-bg-elevated p-4">
        <Field label="Artifact">
          <select
            aria-label="Artifact"
            value={artifactType}
            onChange={(e) => {
              setArtifactType(e.target.value as ArtifactType)
              setModelId('')
            }}
            className={inputClass}
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model">
          <select
            aria-label="Model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a model</option>
            {options.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Variants" hint="One brief, N options.">
          <input
            aria-label="Variants"
            type="number"
            min={1}
            max={MAX_VARIANTS}
            value={variants}
            onChange={(e) =>
              setVariants(Math.max(1, Math.min(MAX_VARIANTS, Number(e.target.value) || 1)))
            }
            className={`${inputClass} w-24`}
          />
        </Field>

        <Button onClick={() => generate.mutate()} disabled={!modelId || generate.isPending}>
          {generate.isPending ? 'Starting…' : 'Generate'} <span aria-hidden="true">→</span>
        </Button>
      </div>

      {options.length === 0 && !providers.isLoading && (
        <p className="text-xs text-text-muted">
          No {wantedType.replace('_', ' ')} is enabled. An admin adds one under Models.
        </p>
      )}

      {created.length > 0 && (
        <ul className="flex flex-col gap-3">
          {created.map((artifact, index) => (
            <li key={artifact.id} className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                Option {index + 1} of {created.length}
              </span>
              <JobProgress artifactId={artifact.id} />
              <Link
                href={`/artifacts/${artifact.id}`}
                className="self-start text-sm text-text underline decoration-border underline-offset-4 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Open artifact <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
