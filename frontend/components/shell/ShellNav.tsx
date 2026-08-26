'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Artifact, Brand, Brief, Me } from '@/lib/types'
import { BrandSwitcher } from './BrandSwitcher'

const ADMIN_LINKS = [
  ['/admin/models', 'Models'],
  ['/admin/skills', 'Skills'],
] as const

// Client half of the header: queries /brands for the switcher and /me for the
// admin links. Admin links are affordance only — the backend guards its routes.
export function ShellNav() {
  const pathname = usePathname()
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => apiFetch<Brand[]>('/brands') })

  // The current brand comes from the route when it carries one, otherwise from
  // the brief/artifact the page is showing. These reuse the pages' own query
  // keys, so the cache is shared and nothing is fetched twice or on other routes.
  const brandRouteId = pathname.match(/^\/brands\/([^/]+)/)?.[1]
  const briefRouteId = pathname.match(/^\/briefs\/([^/]+)/)?.[1]
  const artifactRouteId = pathname.match(/^\/artifacts\/([^/]+)/)?.[1]

  const brief = useQuery({
    queryKey: ['brief', briefRouteId],
    queryFn: () => apiFetch<Brief>(`/briefs/${briefRouteId}`),
    enabled: Boolean(briefRouteId),
  })
  const artifact = useQuery({
    queryKey: ['artifact', artifactRouteId],
    queryFn: () => apiFetch<Artifact>(`/artifacts/${artifactRouteId}`),
    enabled: Boolean(artifactRouteId),
  })

  const currentId = brandRouteId ?? brief.data?.brand_id ?? artifact.data?.brand_id
  const isAdmin = me.data?.role === 'admin'

  return (
    <div className="flex items-center gap-4">
      {brands.data && brands.data.length > 0 && (
        <BrandSwitcher brands={brands.data} currentId={currentId} />
      )}
      {isAdmin && (
        <nav aria-label="Admin" className="flex items-center gap-3 text-sm">
          {ADMIN_LINKS.map(([href, label]) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-2.5 py-1 transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  active ? 'text-accent' : 'text-text-muted hover:text-text'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}
