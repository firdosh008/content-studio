'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { Brand, Me } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Spinner } from '@/components/ui/Spinner'

export default function BrandsPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => apiFetch<Brand[]>('/brands') })

  const create = useMutation({
    mutationFn: (brandName: string) =>
      apiFetch<Brand>('/brands', { method: 'POST', body: JSON.stringify({ name: brandName }) }),
    onSuccess: () => {
      setName('')
      queryClient.invalidateQueries({ queryKey: ['brands'] })
    },
  })

  if (brands.isLoading) return <Spinner />
  const isAdmin = me.data?.role === 'admin'

  return (
    <section className="flex flex-col gap-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Brands
        </p>
        <h1 className="mt-2 font-display text-4xl text-text">
          Every brand, <em className="italic text-accent">one login</em>.
        </h1>
      </div>
      <ErrorBanner error={brands.error ?? create.error} />

      {brands.data?.length === 0 && (
        <EmptyState
          title="No brands yet"
          hint={
            isAdmin
              ? 'Create one, then write its DESIGN.md and VOICE.md.'
              : 'An admin needs to create the first brand.'
          }
        />
      )}

      {brands.data && brands.data.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
          {brands.data.map((brand) => (
            <li key={brand.id} className="flex items-baseline gap-3 px-4 py-3">
              <Link
                href={`/brands/${brand.id}`}
                className="text-text hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                {brand.name}
              </Link>
              <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                {brand.slug}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(name.trim())
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New brand name"
            placeholder="New brand name"
            className="flex-1 rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Create <span aria-hidden="true">→</span>
          </Button>
        </form>
      )}
    </section>
  )
}
