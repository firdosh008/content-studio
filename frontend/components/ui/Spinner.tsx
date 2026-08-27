export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-text-muted"
    >
      <span aria-hidden="true" className="animate-pulse text-accent">
        •
      </span>
      {label}…
    </span>
  )
}
