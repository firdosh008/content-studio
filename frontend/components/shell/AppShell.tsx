import Link from 'next/link'
import { APP_NAME } from '@/lib/appName'
import { SignOutButton } from './SignOutButton'

// Phase 3 adds the brand switcher, nav links and role-aware admin links here.
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-elevated/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link
            href="/brands"
            className="flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true" className="text-accent">
              ▲
            </span>
            <span className="font-display text-xl text-text">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] uppercase tracking-widest text-text-muted sm:inline">
              {email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
