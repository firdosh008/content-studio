'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  ['', 'Overview'],
  ['design', 'DESIGN.md'],
  ['voice', 'VOICE.md'],
  ['references', 'References'],
  ['assets', 'Assets'],
  ['briefs', 'Briefs'],
  ['artifacts', 'Artifacts'],
] as const

export function NavLinks({ brandId }: { brandId: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Brand sections" className="flex flex-col gap-1 text-sm">
      {SECTIONS.map(([segment, label]) => {
        const href = `/brands/${brandId}${segment ? `/${segment}` : ''}`
        const active = pathname === href
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-2.5 py-1.5 transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-bg-inset hover:text-text'
            }`}
          >
            {active && (
              <span aria-hidden="true" className="mr-1.5">
                •
              </span>
            )}
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
