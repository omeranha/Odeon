import { Shuffle, Sparkle } from 'lucide-react'

export function ShuffleIcon({ smart, className }: { smart: boolean; className: string }) {
  return (
    <span className="relative">
      <Shuffle className={className} />
      {smart && <Sparkle className="absolute -top-1.5 -right-1.5 size-2.5" fill="currentColor" />}
    </span>
  )
}
