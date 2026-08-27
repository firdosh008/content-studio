'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Me } from '@/lib/types'
import { ContractEditor } from '@/components/brand/ContractEditor'
import { NavLinks } from '@/components/shell/NavLinks'

export default function VoicePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = use(params)
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
      <NavLinks brandId={brandId} />
      <ContractEditor brandId={brandId} kind="voice" readOnly={me.data?.role !== 'admin'} />
    </div>
  )
}
