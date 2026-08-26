import Link from 'next/link'
import { APP_NAME } from '@/lib/appName'
import { API_MOCK } from '@/lib/mock'
import { ShellNav } from './ShellNav'
import { SignOutButton } from './SignOutButton'
import { DevRoleSwitch } from './DevRoleSwitch'

export function AppShell({
  email,
  children,
  bypass = false,
}: {
  email: string
  children: React.ReactNode
  bypass?: boolean
}) {
  return (
    <div className="min-h-screen">
      {bypass && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-center font-mono text-[11px] uppercase tracking-widest text-warning"
        >
          <span>Dev mode: auth bypass on{API_MOCK ? ', mock API on' : ', no session, no API token'}</span>
          {API_MOCK && <DevRoleSwitch />}
          {API_MOCK && (
            <Link href="/dev/sse" className="underline underline-offset-4 hover:text-text">
              SSE scenarios
            </Link>
          )}
        </div>
      )}
      <header className="sticky top-0 z-10 border-b border-border bg-bg-elevated/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/brands"
              className="flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <span aria-hidden="true" className="text-accent">
                ▲
              </span>
              <span className="font-display text-xl text-text">{APP_NAME}</span>
            </Link>
            <ShellNav />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] uppercase tracking-widest text-text-muted sm:inline">
              {email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] px-6 py-8">{children}</main>
    </div>
  )
}
