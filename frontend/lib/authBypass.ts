/**
 * Dev-only escape hatch so the app can be used before Supabase (and the
 * backend) exist. Set NEXT_PUBLIC_AUTH_BYPASS=true in .env.local.
 *
 * The login page stays: submitting it sets a plain dev-session cookie instead
 * of calling Supabase, the protected layout checks that cookie instead of a
 * Supabase user, and Sign out clears it. Never honored in a production build.
 * With it on there is no real session and no bearer token.
 *
 * See DEV_ONLY_CHANGES.md for the full list of dev-only code and how to remove it.
 */
export const AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_AUTH_BYPASS === 'true'

export const DEV_SESSION_COOKIE = 'cs-dev-session'
export const BYPASS_EMAIL = 'dev-bypass@local'

export function setDevSession(email: string) {
  document.cookie = `${DEV_SESSION_COOKIE}=${encodeURIComponent(email || BYPASS_EMAIL)}; path=/; samesite=lax`
}

export function clearDevSession() {
  document.cookie = `${DEV_SESSION_COOKIE}=; path=/; max-age=0`
}
