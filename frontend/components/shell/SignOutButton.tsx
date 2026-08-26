'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { AUTH_BYPASS, clearDevSession } from '@/lib/authBypass'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    if (AUTH_BYPASS) {
      clearDevSession() // dev-only: no Supabase session to end
    } else {
      const supabase = createBrowserSupabase()
      await supabase.auth.signOut()
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text transition hover:bg-bg-inset focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      Sign out
    </button>
  )
}
