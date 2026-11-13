import clsx from 'clsx'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { shuffleLabel, usePlayerStore } from '../player/playerStore'
import { ShuffleIcon } from '../player/ShuffleIcon'

const DEFAULT_COLOR = '83 83 83'

interface CollectionPageProps {
  color?: string
  artwork: ReactNode
  roundArtwork?: boolean
  label: string
  title: string
  onTitleClick?: () => void
  description?: string
  meta: ReactNode
  actions: ReactNode
  children: ReactNode
}

export function CollectionPage({ color = DEFAULT_COLOR, artwork, roundArtwork = false, label, title, onTitleClick, description, meta, actions, children }: CollectionPageProps) {
  const titleSize = title.length > 40 ? 'md:text-4xl' : title.length > 20 ? 'md:text-5xl' : 'md:text-6xl lg:text-7xl'
  const titleClass = clsx('line-clamp-3 text-2xl font-bold break-words md:font-black md:tracking-tight', titleSize)

  return (
    <div className="min-h-full pb-8">
      <header className="relative flex flex-col items-center gap-4 px-4 pt-14 pb-4 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-16 md:pb-6" style={{ backgroundColor: `rgb(${color})` }}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/50" />
        <BackButton />
        <div className={clsx('relative size-48 shrink-0 overflow-hidden shadow-2xl shadow-black/60 md:size-52 lg:size-56', roundArtwork ? 'rounded-full' : 'rounded')}>{artwork}</div>
        <div className="relative flex min-w-0 flex-col gap-2 self-stretch md:self-auto">
          <p className="hidden text-sm font-medium md:block">{label}</p>
          {onTitleClick ? (
            <button type="button" onClick={onTitleClick} className={clsx(titleClass, 'text-left')}>
              {title}
            </button>
          ) : (
            <h1 className={titleClass}>{title}</h1>
          )}
          {description && <p className="line-clamp-2 text-sm text-white/70">{description}</p>}
          <div className="flex flex-wrap items-center gap-x-1 text-sm text-white/80 [&_a]:font-bold [&_a]:text-white [&_a:hover]:underline">{meta}</div>
        </div>
      </header>
      <div style={{ backgroundImage: `linear-gradient(rgb(${color} / 0.35), transparent 240px)` }}>
        <div className="flex items-center gap-6 px-4 py-4 md:px-6 md:py-6">{actions}</div>
        {children}
      </div>
    </div>
  )
}

function BackButton() {
  const navigate = useNavigate()
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <button type="button" aria-label="Go back" onClick={() => (canGoBack ? navigate(-1) : navigate('/'))} className="absolute top-3 left-3 z-10 grid size-9 place-items-center rounded-full bg-black/40 md:hidden">
      <ChevronLeft className="size-6" />
    </button>
  )
}

export function ShuffleToggle() {
  const shuffle = usePlayerStore((state) => state.shuffle)
  const smartShuffle = usePlayerStore((state) => state.smartShuffle)
  const cycleShuffle = usePlayerStore((state) => state.cycleShuffle)
  return (
    <button type="button" aria-label={shuffleLabel(shuffle, smartShuffle, true)} aria-pressed={shuffle} onClick={cycleShuffle} className={clsx('relative transition hover:scale-105', shuffle ? 'text-accent' : 'text-subdued hover:text-white')}>
      <ShuffleIcon smart={smartShuffle} className="size-7" />
      {shuffle && <span className="absolute -bottom-2 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
    </button>
  )
}

export function MetaSeparator() {
  return <span aria-hidden="true">•</span>
}
