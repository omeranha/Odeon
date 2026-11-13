import clsx from 'clsx'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <path d="M106 350a150 150 0 0 1 300 0" fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round" />
      <path d="M86 350h340" stroke="currentColor" strokeWidth="40" strokeLinecap="round" />
      <path d="M232 258v76l66-38z" fill="currentColor" stroke="currentColor" strokeWidth="12" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 font-bold tracking-tight', className)}>
      <LogoMark className="size-[1.6em] text-accent" />
      Odeon
    </span>
  )
}
