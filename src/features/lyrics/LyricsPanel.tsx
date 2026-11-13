import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../player/playerStore'
import { useTransport } from '../player/transport'
import { activeLineIndex, useLyrics } from './lyrics'

export function LyricsPanel() {
  const open = usePlayerStore((state) => state.lyricsOpen)
  if (!open) return null
  return <LyricsView />
}

function LyricsView() {
  const { song, position, seek } = useTransport()
  const { data, isPending } = useLyrics(song)
  const setLyricsOpen = usePlayerStore((state) => state.setLyricsOpen)
  const activeRef = useRef<HTMLButtonElement>(null)
  const synced = data?.synced ?? null
  const active = synced ? activeLineIndex(synced, position) : -1

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  return (
    <aside aria-label="Lyrics" className="fixed inset-0 z-[55] flex flex-col bg-surface pt-[env(safe-area-inset-top)] md:static md:z-auto md:w-80 md:shrink-0 md:rounded-lg md:pt-0 lg:w-[340px]">
      <header className="flex items-center justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <h2 className="font-bold">Lyrics</h2>
          {song && <p className="truncate text-xs text-subdued">{song.title}</p>}
        </div>
        <button type="button" aria-label="Close lyrics" onClick={() => setLyricsOpen(false)} className="grid size-8 place-items-center rounded-full text-subdued hover:bg-highlight hover:text-white">
          <X className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {!song ? (
          <p className="text-sm text-subdued">Play something to see its lyrics.</p>
        ) : isPending ? (
          <p className="text-sm text-subdued">Looking for lyrics…</p>
        ) : synced ? (
          <ol className="flex flex-col gap-3 py-[30%]">
            {synced.map((line, index) => (
              <li key={`${line.time}-${index}`}>
                <button
                  type="button"
                  ref={index === active ? activeRef : undefined}
                  onClick={() => seek(line.time)}
                  className={clsx('text-left text-xl leading-snug font-bold transition-colors', index === active ? 'text-white' : 'text-white/40 hover:text-white/70')}
                >
                  {line.text || '♪'}
                </button>
              </li>
            ))}
          </ol>
        ) : data?.plain ? (
          <p className="py-2 text-base leading-relaxed whitespace-pre-wrap">{data.plain}</p>
        ) : (
          <p className="text-sm text-subdued">No lyrics found for this song.</p>
        )}
      </div>
    </aside>
  )
}
