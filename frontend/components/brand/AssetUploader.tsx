'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Asset, AssetType } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ErrorBanner } from '@/components/ui/ErrorBanner'

const TYPES: AssetType[] = ['logo', 'font', 'headshot', 'screenshot', 'icon']

const inputClass =
  'rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent'

export function AssetUploader({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [assetType, setAssetType] = useState<AssetType>('logo')
  const [label, setLabel] = useState('')

  const upload = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0]
      if (!file) throw new Error('Choose a file first')
      const body = new FormData()
      body.append('file', file)
      body.append('asset_type', assetType)
      body.append('label', label || file.name)
      return apiFetch<Asset>(`/brands/${brandId}/assets`, { method: 'POST', body })
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = ''
      setLabel('')
      queryClient.invalidateQueries({ queryKey: ['assets', brandId] })
    },
  })

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
        <span className="text-accent">•</span> Add an asset
      </p>
      <p className="text-sm text-text-muted">
        Generated artifacts inject these real files. An AI-approximated logo is never acceptable
        output, and font files must live here or typography falls back silently.
      </p>
      <ErrorBanner error={upload.error} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="File">
          <input
            ref={fileRef}
            type="file"
            className="text-sm text-text-muted file:mr-3 file:rounded-full file:border file:border-border file:bg-bg-elevated file:px-3 file:py-1 file:text-sm file:text-text"
          />
        </Field>
        <Field label="Type">
          <select
            aria-label="Type"
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetType)}
            className={inputClass}
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input
            aria-label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Primary lockup"
            className={inputClass}
          />
        </Field>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
    </section>
  )
}
