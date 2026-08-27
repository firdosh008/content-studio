import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { AUTH_BYPASS, BYPASS_EMAIL, DEV_SESSION_COOKIE } from '@/lib/authBypass'
import { AppShell } from '@/components/shell/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Dev-only (NEXT_PUBLIC_AUTH_BYPASS=true): the login page sets a plain cookie
  // instead of a Supabase session. Ignored in production builds.
  if (AUTH_BYPASS) {
    const devSession = (await cookies()).get(DEV_SESSION_COOKIE)?.value
    if (!devSession) redirect('/login')
    return (
      <AppShell email={decodeURIComponent(devSession) || BYPASS_EMAIL} bypass>
        {children}
      </AppShell>
    )
  }

  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return <AppShell email={data.user.email ?? ''}>{children}</AppShell>
}
