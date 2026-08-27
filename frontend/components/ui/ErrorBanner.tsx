import { ApiError } from '@/lib/api'

// Backend `detail` strings are shown verbatim — never rewritten.
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  const message =
    error instanceof ApiError ? error.detail : error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  )
}
