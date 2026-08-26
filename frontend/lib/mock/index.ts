/**
 * Dev-only mock API. Set NEXT_PUBLIC_API_MOCK=true and every apiFetch call is
 * answered from lib/mock/handler.ts instead of the network. Never honored in a
 * production build.
 *
 * The mock role (admin | member) can be switched at runtime from the dev
 * banner; it is kept in sessionStorage so it survives a reload of the tab.
 * NEXT_PUBLIC_MOCK_ROLE only sets the default.
 */
export const API_MOCK =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_API_MOCK === 'true'

export type MockRole = 'admin' | 'member'

export const MOCK_ROLE_DEFAULT: MockRole =
  process.env.NEXT_PUBLIC_MOCK_ROLE === 'member' ? 'member' : 'admin'

export const MOCK_ROLE_KEY = 'cs-mock-role'

export function getMockRole(): MockRole {
  if (typeof sessionStorage === 'undefined') return MOCK_ROLE_DEFAULT
  try {
    const stored = sessionStorage.getItem(MOCK_ROLE_KEY)
    return stored === 'member' || stored === 'admin' ? stored : MOCK_ROLE_DEFAULT
  } catch {
    return MOCK_ROLE_DEFAULT
  }
}

export function setMockRole(role: MockRole) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(MOCK_ROLE_KEY, role)
  } catch {}
}
