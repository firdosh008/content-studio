import { chromium, type FullConfig } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Signs the seeded E2E users in and saves Playwright storage states.
 *
 * Magic links cannot be automated, so the seeded test users need a password
 * (set it once in the Supabase dashboard or via the admin API). The session is
 * written as the cookie `@supabase/ssr` expects, so the app's middleware and
 * server components see a real, refreshable session.
 *
 * Skips silently when the E2E env is absent; the specs then skip too.
 */
export const AUTH_DIR = path.join(__dirname, '.auth')
export const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json')
export const MEMBER_STATE = path.join(AUTH_DIR, 'member.json')

export function e2eEnv() {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    E2E_ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD,
    E2E_MEMBER_EMAIL,
    E2E_MEMBER_PASSWORD,
  } = process.env
  if (!url || !anonKey || !E2E_ADMIN_EMAIL || !E2E_ADMIN_PASSWORD) return null
  return {
    url,
    anonKey,
    admin: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
    member:
      E2E_MEMBER_EMAIL && E2E_MEMBER_PASSWORD
        ? { email: E2E_MEMBER_EMAIL, password: E2E_MEMBER_PASSWORD }
        : null,
  }
}

// @supabase/ssr cookie encoding: "base64-" + base64url(JSON), chunked when long.
const CHUNK = 3180
function sessionCookies(name: string, session: object, domain: string) {
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const values =
    encoded.length <= CHUNK
      ? [{ name, value: encoded }]
      : Array.from({ length: Math.ceil(encoded.length / CHUNK) }, (_, i) => ({
          name: `${name}.${i}`,
          value: encoded.slice(i * CHUNK, (i + 1) * CHUNK),
        }))
  return values.map((cookie) => ({
    ...cookie,
    domain,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }))
}

async function saveState(
  env: NonNullable<ReturnType<typeof e2eEnv>>,
  user: { email: string; password: string },
  file: string,
  baseURL: string,
) {
  const supabase = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword(user)
  if (error || !data.session) throw new Error(`E2E sign-in failed for ${user.email}: ${error?.message}`)

  const projectRef = new URL(env.url).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const domain = new URL(baseURL).hostname

  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addCookies(sessionCookies(cookieName, data.session, domain))
  await context.storageState({ path: file })
  await browser.close()
}

export default async function globalSetup(config: FullConfig) {
  const env = e2eEnv()
  mkdirSync(AUTH_DIR, { recursive: true })
  if (!env) {
    // Empty states keep `storageState` references valid; the specs skip themselves.
    for (const file of [ADMIN_STATE, MEMBER_STATE]) {
      writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }))
    }
    return
  }
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000'
  await saveState(env, env.admin, ADMIN_STATE, baseURL)
  if (env.member) await saveState(env, env.member, MEMBER_STATE, baseURL)
  else writeFileSync(MEMBER_STATE, JSON.stringify({ cookies: [], origins: [] }))
}
