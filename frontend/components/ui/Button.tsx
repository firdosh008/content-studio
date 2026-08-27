type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}

const STYLES = {
  primary:
    'bg-accent text-accent-fg shadow-[0_0_24px_rgba(232,84,58,0.25)] hover:bg-accent-hover',
  ghost: 'border border-border bg-bg-elevated text-text hover:bg-bg-inset',
  danger: 'bg-danger text-bg hover:opacity-90',
}

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[variant]} ${className}`}
    />
  )
}
