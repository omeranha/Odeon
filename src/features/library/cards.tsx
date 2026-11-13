import clsx from 'clsx'
import { Disc3, Heart, Music, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { PlayButton } from '../../components/PlayButton'
import type { SubsonicAlbum, SubsonicArtist, SubsonicPlaylist, SubsonicSong } from '../../lib/subsonic/types'
import { useIsSourcePlaying, usePlayRemoteCollection } from '../player/playback'
import { useCoverArtUrl } from './queries'

const fallbackIcons = { album: Disc3, artist: User, playlist: Music }

export function CoverArt({ coverArtId, src, size, kind = 'album', className }: { coverArtId?: string; src?: string; size: number; kind?: keyof typeof fallbackIcons; className?: string }) {
  const libraryUrl = useCoverArtUrl(coverArtId, size)
  const url = src ?? libraryUrl
  const [failedUrl, setFailedUrl] = useState<string>()
  const FallbackIcon = fallbackIcons[kind]
  return (
    <span className={clsx('grid shrink-0 place-items-center overflow-hidden bg-highlight text-subdued', className)}>
      {url && url !== failedUrl ? <img src={url} alt="" loading="lazy" draggable={false} referrerPolicy={src ? 'no-referrer' : undefined} onError={() => setFailedUrl(url)} className="size-full object-cover" /> : <FallbackIcon className="size-1/3" />}
    </span>
  )
}

export function SongCover({ song, size, className }: { song: SubsonicSong; size: number; className?: string }) {
  return <CoverArt coverArtId={song.coverArt} src={song.external?.coverUrl} size={size} className={className} />
}

export function LikedSongsArtwork({ className }: { className?: string }) {
  return (
    <span className={clsx('grid shrink-0 place-items-center bg-gradient-to-br from-indigo-700 to-sky-300', className)}>
      <Heart className="size-2/5" fill="currentColor" />
    </span>
  )
}

function CardShell({ to, fluid, artwork, title, subtitle, playButton }: { to: string; fluid?: boolean; artwork: ReactNode; title: string; subtitle?: string; playButton?: ReactNode }) {
  return (
    <Link to={to} className={clsx('group block rounded-md p-2 transition-colors hover:bg-highlight md:p-3', fluid ? 'w-full' : 'w-36 shrink-0 md:w-44')}>
      <div className="relative mb-2">
        {artwork}
        {playButton}
      </div>
      <p className="truncate text-sm font-semibold md:text-base">{title}</p>
      {subtitle && <p className="line-clamp-2 text-sm text-subdued">{subtitle}</p>}
    </Link>
  )
}

function CardPlayButton({ playing, label, onClick }: { playing: boolean; label: string; onClick: () => void }) {
  return (
    <span className={clsx('absolute right-2 bottom-2 hidden transition md:block', playing ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100')}>
      <PlayButton playing={playing} label={label} onClick={onClick} />
    </span>
  )
}

export function AlbumCard({ album, fluid, subtitle }: { album: SubsonicAlbum; fluid?: boolean; subtitle?: string }) {
  const source = { type: 'album' as const, id: album.id, name: album.name }
  const playing = useIsSourcePlaying(source)
  const playCollection = usePlayRemoteCollection()
  return (
    <CardShell
      to={`/album/${album.id}`}
      fluid={fluid}
      artwork={<CoverArt coverArtId={album.coverArt} size={300} className="aspect-square w-full rounded-md shadow-lg shadow-black/50" />}
      title={album.name}
      subtitle={subtitle ?? [album.year, album.artist].filter(Boolean).join(' • ')}
      playButton={<CardPlayButton playing={playing} label={album.name} onClick={() => void playCollection(source)} />}
    />
  )
}

export function PlaylistCard({ playlist, fluid }: { playlist: SubsonicPlaylist; fluid?: boolean }) {
  const source = { type: 'playlist' as const, id: playlist.id, name: playlist.name }
  const playing = useIsSourcePlaying(source)
  const playCollection = usePlayRemoteCollection()
  return (
    <CardShell
      to={`/playlist/${playlist.id}`}
      fluid={fluid}
      artwork={<CoverArt coverArtId={playlist.coverArt} size={300} kind="playlist" className="aspect-square w-full rounded-md shadow-lg shadow-black/50" />}
      title={playlist.name}
      subtitle={playlist.owner ? `By ${playlist.owner}` : undefined}
      playButton={playlist.songCount > 0 && <CardPlayButton playing={playing} label={playlist.name} onClick={() => void playCollection(source)} />}
    />
  )
}

export function ArtistCard({ artist, fluid }: { artist: SubsonicArtist; fluid?: boolean }) {
  return <CardShell to={`/artist/${artist.id}`} fluid={fluid} artwork={<CoverArt coverArtId={artist.coverArt ?? artist.id} size={300} kind="artist" className="aspect-square w-full rounded-full shadow-lg shadow-black/50" />} title={artist.name} subtitle="Artist" />
}

export function CardSkeleton() {
  return (
    <div className="w-36 shrink-0 p-2 md:w-44 md:p-3">
      <div className="mb-2 aspect-square animate-pulse rounded-md bg-highlight" />
      <div className="mb-1.5 h-4 w-3/4 animate-pulse rounded bg-highlight" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-highlight" />
    </div>
  )
}

export function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 px-4 text-xl font-bold md:px-6 md:text-2xl">{title}</h2>
      <div className="scrollbar-none flex overflow-x-auto px-2 md:px-3">{children}</div>
    </section>
  )
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 px-2 sm:grid-cols-3 md:px-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>
}
