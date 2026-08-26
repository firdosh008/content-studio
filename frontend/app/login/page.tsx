'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { APP_NAME } from '@/lib/appName'
import { AUTH_BYPASS, setDevSession } from '@/lib/authBypass'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    if (AUTH_BYPASS) {
      // Dev-only: no Supabase. A plain cookie stands in for the session.
      setDevSession(email)
      router.replace('/brands')
      router.refresh()
      return
    }
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setPending(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-elevated p-8 shadow-[0_0_80px_rgba(232,84,58,0.08)]">
        <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
          <span className="text-accent">•</span> Sign in
        </p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-text">{APP_NAME}</h1>
        <p className="mt-2 text-sm text-text-muted">
          Magic link. No password, <em className="font-display italic text-accent">nothing to remember</em>.
        </p>

        {sent ? (
          <p role="status" className="mt-6 rounded-lg border border-border bg-bg-inset p-4 text-sm text-text">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={signIn} className="mt-6 flex flex-col gap-3">
            <label htmlFor="email" className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="submit"
              disabled={pending}
              className="mt-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg shadow-[0_0_24px_rgba(232,84,58,0.25)] transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated disabled:opacity-50"
            >
              {AUTH_BYPASS ? 'Sign in (dev, no magic link)' : 'Send sign-in link'}{' '}
              <span aria-hidden="true">→</span>
            </button>
            {AUTH_BYPASS && (
              <p className="font-mono text-[11px] uppercase tracking-widest text-warning">
                Dev mode: signs in without Supabase
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  )
}
