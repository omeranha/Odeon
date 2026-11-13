import clsx from 'clsx'
import { Sparkle, X } from 'lucide-react'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { SongCover } from '../library/cards'
import { usePlayerStore } from './playerStore'

const MAX_UPCOMING = 200

export function QueuePanel() {
  const open = usePlayerStore((state) => state.queueOpen)
  if (!open) return null
  return <QueueView />
}

function QueueView() {
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const queuedCount = usePlayerStore((state) => state.queuedCount)
  const source = usePlayerStore((state) => state.source)
  const { jumpTo, removeFromQueue, setQueueOpen } = usePlayerStore.getState()
  const current = queue[currentIndex]
  const queuedEnd = currentIndex + 1 + queuedCount
  const queued = queue.slice(currentIndex + 1, queuedEnd)
  const rest = queue.slice(queuedEnd, queuedEnd + MAX_UPCOMING)

  const renderRow = (song: SubsonicSong, index: number) => <QueueRow key={`${song.id}-${index}`} song={song} onPlay={() => jumpTo(index)} onRemove={() => removeFromQueue(index)} />

  return (
    <aside aria-label="Queue" className="fixed inset-0 z-[55] flex flex-col bg-surface pt-[env(safe-area-inset-top)] md:static md:z-auto md:w-80 md:shrink-0 md:rounded-lg md:pt-0 lg:w-[340px]">
      <header className="flex items-center justify-between px-4 py-4">
        <h2 className="font-bold">Queue</h2>
        <button type="button" aria-label="Close queue" onClick={() => setQueueOpen(false)} className="grid size-8 place-items-center rounded-full text-subdued hover:bg-highlight hover:text-white">
          <X className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {current ? (
          <>
            <h3 className="px-2 pb-2 font-bold">Now playing</h3>
            <QueueRow song={current} active />
            {queued.length > 0 && <h3 className="px-2 pt-6 pb-2 font-bold">Next in queue</h3>}
            {queued.map((song, offset) => renderRow(song, currentIndex + 1 + offset))}
            {rest.length > 0 && <h3 className="truncate px-2 pt-6 pb-2 font-bold">Next from: {source?.name ?? 'your queue'}</h3>}
            {rest.map((song, offset) => renderRow(song, queuedEnd + offset))}
          </>
        ) : (
          <p className="px-2 text-sm text-subdued">Your queue is empty. Play something to get started.</p>
        )}
      </div>
    </aside>
  )
}

function QueueRow({ song, active = false, onPlay, onRemove }: { song: SubsonicSong; active?: boolean; onPlay?: () => void; onRemove?: () => void }) {
  return (
    <div className="group flex items-center gap-3 rounded-md p-2 hover:bg-white/10">
      <button type="button" onClick={onPlay} disabled={!onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <SongCover song={song} size={80} className="size-10 rounded" />
        <span className="min-w-0">
          <span className={clsx('block truncate', active ? 'text-accent' : 'text-white')}>{song.title}</span>
          <span className="flex items-center gap-1 text-sm text-subdued">
            {song.suggested && <Sparkle className="size-3 shrink-0 text-accent" fill="currentColor" aria-label={song.suggested === 'smart' ? 'Added by smart shuffle' : 'Added by autoplay'} />}
            <span className="truncate">{song.artist}</span>
          </span>
        </span>
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${song.title} from queue`} onClick={onRemove} className="text-subdued hover:text-white md:opacity-0 md:group-hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
