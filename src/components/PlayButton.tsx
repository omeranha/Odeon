import clsx from 'clsx'
import { Pause, Play } from 'lucide-react'

const sizes = {
  sm: { button: 'size-10', icon: 'size-4' },
  md: { button: 'size-12', icon: 'size-5' },
  lg: { button: 'size-14', icon: 'size-6' },
}

export function PlayButton({ playing, onClick, label, size = 'md', className }: { playing: boolean; onClick: () => void; label: string; size?: keyof typeof sizes; className?: string }) {
  return (
    <button
      type="button"
      aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={clsx('grid shrink-0 place-items-center rounded-full bg-accent text-black shadow-lg shadow-black/40 transition hover:scale-105 hover:bg-accent-hover active:scale-100', sizes[size].button, className)}
    >
      {playing ? <Pause className={sizes[size].icon} fill="currentColor" /> : <Play className={clsx(sizes[size].icon, 'translate-x-px')} fill="currentColor" />}
    </button>
  )
}
