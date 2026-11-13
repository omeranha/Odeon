import { ChevronDown, ListMusic, MicVocal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { DropdownMenu } from '../../components/DropdownMenu'
import { QualityBadge } from '../../components/QualityBadge'
import { useDominantColor } from '../../lib/hooks'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { SongCover } from '../library/cards'
import { LikeButton } from '../library/LikeButton'
import { useCoverArtUrl } from '../library/queries'
import { useSongMenuItems } from '../library/songMenu'
import { SongMenuHeader } from '../library/SongMenuHeader'
import { RemoteDevicesButton, PlayingOnLabel } from '../remote/RemoteDevices'
import { PlaybackProgress, TransportControls } from './controls'
import { usePlayerStore, type PlaySourceType } from './playerStore'
import { useTransport } from './transport'

const COVER_SIZE = 600

const sourceLabels: Record<PlaySourceType, string> = {
  album: 'Playing from album',
  playlist: 'Playing from playlist',
  artist: 'Playing from artist',
  liked: 'Playing from your library',
  search: 'Playing from search',
}

export function FullScreenPlayer() {
  const open = usePlayerStore((state) => state.fullScreenOpen)
  const { song, remoteName } = useTransport()
  if (!open || !song) return null
  return <FullScreenView song={song} remoteName={remoteName} />
}

function FullScreenView({ song, remoteName }: { song: SubsonicSong; remoteName: string | null }) {
  const source = usePlayerStore((state) => state.source)
  const { setFullScreenOpen, setQueueOpen, setLyricsOpen } = usePlayerStore.getState()
  const color = useDominantColor(useCoverArtUrl(song.coverArt, COVER_SIZE))
  const menuItems = useSongMenuItems(song)
  const { pathname } = useLocation()
  const [openedAt] = useState(pathname)

  useEffect(() => {
    if (pathname !== openedAt) setFullScreenOpen(false)
  }, [pathname, openedAt, setFullScreenOpen])

  return (
    <div className="fixed inset-0 z-50 flex flex-col px-6 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:hidden" style={{ backgroundImage: `linear-gradient(rgb(${color ?? '83 83 83'}), #121212 85%)` }}>
      <header className="flex items-center justify-between gap-4">
        <button type="button" aria-label="Close player" onClick={() => setFullScreenOpen(false)} className="-ml-1 p-1">
          <ChevronDown className="size-7" />
        </button>
        <div className="min-w-0 text-center">
          <p className="text-[11px] tracking-widest text-white/70 uppercase">{source ? sourceLabels[source.type] : 'Now playing'}</p>
          <p className="truncate text-sm font-bold">{source?.name}</p>
        </div>
        <DropdownMenu label="More options" items={menuItems} header={<SongMenuHeader song={song} />} className="p-1 text-white" />
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center py-8">
        <SongCover song={song} size={COVER_SIZE} className="aspect-square w-full max-w-[min(100%,55dvh)] rounded-lg shadow-2xl shadow-black/60" />
      </div>

      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-bold">{song.title}</p>
          <div className="flex min-w-0 items-center gap-2">
            {song.artistId ? (
              <Link to={`/artist/${song.artistId}`} className="truncate text-white/70">
                {song.artist}
              </Link>
            ) : (
              <p className="truncate text-white/70">{song.artist}</p>
            )}
            <QualityBadge song={song} className="border-white/40 text-white/70" />
          </div>
          {remoteName && <PlayingOnLabel name={remoteName} />}
        </div>
        {!song.external && !remoteName && <LikeButton kind="song" item={song} size="lg" />}
      </div>

      <div className="mt-5">
        <PlaybackProgress large />
      </div>
      <div className="mt-4">
        <TransportControls large />
      </div>
      <div className="mt-6 flex items-center justify-end gap-6">
        <RemoteDevicesButton className="[&_svg]:size-5" />
        <button type="button" aria-label="Open lyrics" onClick={() => setLyricsOpen(true)} className="text-white/80 hover:text-white">
          <MicVocal className="size-5" />
        </button>
        <button type="button" aria-label="Open queue" onClick={() => setQueueOpen(true)} className="text-white/80 hover:text-white">
          <ListMusic className="size-5" />
        </button>
      </div>
    </div>
  )
}
