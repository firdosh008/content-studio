import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return <AppShell email={data.user.email ?? ''}>{children}</AppShell>
}
