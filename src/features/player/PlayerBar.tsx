import clsx from 'clsx'
import { QualityBadge } from '../../components/QualityBadge'
import { ListMusic, MicVocal } from 'lucide-react'
import { Link } from 'react-router'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { SongCover } from '../library/cards'
import { LikeButton } from '../library/LikeButton'
import { PlayingOnLabel, RemoteDevicesButton } from '../remote/RemoteDevices'
import { PlaybackProgress, TransportControls, VolumeControl } from './controls'
import { usePlayerStore } from './playerStore'
import { useTransport } from './transport'

export function PlayerBar() {
  const { song, remoteName } = useTransport()
  const queueOpen = usePlayerStore((state) => state.queueOpen)
  const setQueueOpen = usePlayerStore((state) => state.setQueueOpen)
  const lyricsOpen = usePlayerStore((state) => state.lyricsOpen)
  const setLyricsOpen = usePlayerStore((state) => state.setLyricsOpen)

  return (
    <footer className="hidden h-[72px] shrink-0 grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_minmax(180px,1fr)] items-center gap-4 px-2 md:grid">
      {song ? <NowPlaying song={song} remoteName={remoteName} /> : <div />}
      <div className="flex flex-col items-center gap-1.5">
        <TransportControls />
        <div className="w-full max-w-[600px]">
          <PlaybackProgress />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        <RemoteDevicesButton />
        <button type="button" aria-label="Lyrics" aria-pressed={lyricsOpen} onClick={() => setLyricsOpen(!lyricsOpen)} className={clsx('transition hover:scale-105', lyricsOpen ? 'text-accent' : 'text-subdued hover:text-white')}>
          <MicVocal className="size-4" />
        </button>
        <button type="button" aria-label="Queue" aria-pressed={queueOpen} onClick={() => setQueueOpen(!queueOpen)} className={clsx('transition hover:scale-105', queueOpen ? 'text-accent' : 'text-subdued hover:text-white')}>
          <ListMusic className="size-4" />
        </button>
        <VolumeControl />
      </div>
    </footer>
  )
}

function NowPlaying({ song, remoteName }: { song: SubsonicSong; remoteName: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link to={song.albumId ? `/album/${song.albumId}` : '#'} aria-label={song.album ?? song.title}>
        <SongCover song={song} size={112} className="size-14 rounded" />
      </Link>
      <div className="min-w-0">
        <Link to={song.albumId ? `/album/${song.albumId}` : '#'} className="block truncate text-sm hover:underline">
          {song.title}
        </Link>
        <div className="flex min-w-0 items-center gap-1.5">
          {song.artistId ? (
            <Link to={`/artist/${song.artistId}`} className="truncate text-xs text-subdued hover:text-white hover:underline">
              {song.artist}
            </Link>
          ) : (
            <p className="truncate text-xs text-subdued">{song.artist}</p>
          )}
          <QualityBadge song={song} />
        </div>
        {remoteName && <PlayingOnLabel name={remoteName} />}
      </div>
      {!remoteName && <LikeButton kind="song" item={song} size="sm" className="ml-2" />}
    </div>
  )
}
