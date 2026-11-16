import { Pause, Play } from 'lucide-react'
import { QualityBadge } from '../../components/QualityBadge'
import { useDominantColor } from '../../lib/hooks'
import { SongCover } from '../library/cards'
import { LikeButton } from '../library/LikeButton'
import { useCoverArtUrl } from '../library/queries'
import { PlayingOnLabel } from '../remote/RemoteDevices'
import { usePlayerStore } from './playerStore'
import { useTransport } from './transport'

const COVER_SIZE = 112

export function MiniPlayer() {
  const { song, isPlaying, position, duration, togglePlay, remoteName } = useTransport()
  const color = useDominantColor(useCoverArtUrl(song?.coverArt, COVER_SIZE))
  if (!song) return null

  const { setFullScreenOpen } = usePlayerStore.getState()
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0

  return (
    <div className="fixed inset-x-2 bottom-[calc(3.5rem+var(--nav-inset))] z-40 md:hidden">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Now playing: ${song.title}. Open player`}
        onClick={() => setFullScreenOpen(true)}
        onKeyDown={(event) => event.key === 'Enter' && setFullScreenOpen(true)}
        className="relative flex items-center gap-3 overflow-hidden rounded-md p-2 shadow-lg shadow-black/50 transition-colors"
        style={{ backgroundColor: color ? `rgb(${color})` : '#3a3a3a' }}
      >
        <SongCover song={song} size={COVER_SIZE} className="size-10 rounded" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{song.title}</p>
          {remoteName ? <PlayingOnLabel name={remoteName} /> : <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-xs text-white/70">{song.artist}</p>
              <QualityBadge song={song} className="border-white/40 text-white/70" />
            </div>}
        </div>
        {!remoteName && <LikeButton kind="song" item={song} size="md" className="!text-white data-[starred=true]:!text-accent" />}
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={(event) => {
            event.stopPropagation()
            togglePlay()
          }}
          className="grid size-10 place-items-center"
        >
          {isPlaying ? <Pause className="size-6" fill="currentColor" /> : <Play className="size-6" fill="currentColor" />}
        </button>
        <div className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  )
}
