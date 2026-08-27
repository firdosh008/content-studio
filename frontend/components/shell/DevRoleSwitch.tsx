'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { getMockRole, setMockRole, type MockRole } from '@/lib/mock'

// Dev-only: rendered inside the dev banner when the API mock is on. Switches
// the role the mock `/me` reports without restarting the app. Never in production.
export function DevRoleSwitch() {
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<MockRole>('admin')

  useEffect(() => {
    setRole(getMockRole())
  }, [])

  async function switchTo(next: MockRole) {
    if (next === role) return
    setMockRole(next)
    setRole(next)
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    await queryClient.invalidateQueries()
    if (next === 'member' && pathname.startsWith('/admin')) router.push('/brands')
  }

  async function resetData() {
    const { resetMockState } = await import('@/lib/mock/data')
    resetMockState()
    await queryClient.invalidateQueries()
    router.push('/brands')
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span role="group" aria-label="Mock role" className="inline-flex overflow-hidden rounded-full border border-warning/40">
        {(['admin', 'member'] as MockRole[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={role === value}
            onClick={() => switchTo(value)}
            className={`px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              role === value ? 'bg-warning text-bg' : 'text-warning hover:bg-warning/15'
            }`}
          >
            {value}
          </button>
        ))}
      </span>
      <button
        type="button"
        onClick={resetData}
        className="rounded-full border border-warning/40 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-widest text-warning hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        Reset mock data
      </button>
    </span>
  )
}
