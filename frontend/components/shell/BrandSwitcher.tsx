'use client'
import { useRouter } from 'next/navigation'
import type { Brand } from '@/lib/types'

export function BrandSwitcher({ brands, currentId }: { brands: Brand[]; currentId?: string }) {
  const router = useRouter()
  return (
    <select
      aria-label="Brand"
      value={currentId ?? ''}
      onChange={(e) => router.push(`/brands/${e.target.value}`)}
      className="rounded-lg border border-border bg-bg-inset px-2 py-1 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <option value="" disabled>
        Select a brand
      </option>
      {brands.map((brand) => (
        <option key={brand.id} value={brand.id}>
          {brand.name}
        </option>
      ))}
    </select>
  )
}
