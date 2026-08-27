'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me } from '@/lib/types'
import { NavLinks } from '@/components/shell/NavLinks'
import { AssetUploader } from '@/components/brand/AssetUploader'
import { AssetGrid } from '@/components/brand/AssetGrid'

export default function AssetsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const isAdmin = me.data?.role === 'admin'
  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
      <NavLinks brandId={brandId} />
      <div className="flex flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            <span className="text-accent">•</span> Brand contract
          </p>
          <h1 className="mt-2 font-display text-4xl text-text">Assets</h1>
        </div>
        {isAdmin && <AssetUploader brandId={brandId} />}
        <AssetGrid brandId={brandId} readOnly={!isAdmin} />
      </div>
    </div>
  )
}
