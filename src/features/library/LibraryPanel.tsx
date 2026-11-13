import clsx from 'clsx'
import { Library, Plus, Volume2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { pluralize } from '../../lib/format'
import { isSameSource, usePlayerStore, type PlaySource } from '../player/playerStore'
import { collectionPath, useDownloadedCollections } from '../downloads/hooks'
import { nextPlaylistName, usePlaylistMutations } from '../playlists/mutations'
import { useCurrentProfile } from '../profiles/profileStore'
import { CoverArt, LikedSongsArtwork } from './cards'
import { usePlaylists, useStarred } from './queries'

type LibraryFilter = 'playlists' | 'albums' | 'artists' | 'downloaded'

const filters: { value: LibraryFilter; label: string }[] = [
  { value: 'playlists', label: 'Playlists' },
  { value: 'albums', label: 'Albums' },
  { value: 'artists', label: 'Artists' },
  { value: 'downloaded', label: 'Downloaded' },
]

export function LibraryPanel({ leading }: { leading?: ReactNode }) {
  const profile = useCurrentProfile()
  const navigate = useNavigate()
  const { data: playlists = [] } = usePlaylists()
  const { data: starred } = useStarred()
  const { create } = usePlaylistMutations()
  const [filter, setFilter] = useState<LibraryFilter | null>(null)
  const [creating, setCreating] = useState(false)
  const downloaded = useDownloadedCollections()
  const shows = (type: LibraryFilter) => filter === null || filter === type

  async function handleCreate() {
    setCreating(true)
    const created = await create(nextPlaylistName(playlists, profile))
    setCreating(false)
    if (created) navigate(`/playlist/${created.id}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 md:px-5">
        <div className="flex items-center gap-3">
          {leading}
          <h2 className="flex items-center gap-3 text-2xl font-bold md:text-base md:text-subdued">
            <Library className="hidden size-6 md:block" />
            Your Library
          </h2>
        </div>
        <button type="button" aria-label="Create playlist" disabled={creating} onClick={() => void handleCreate()} className="grid size-8 place-items-center rounded-full text-subdued transition hover:bg-highlight hover:text-white disabled:opacity-50">
          <Plus className="size-5" />
        </button>
      </header>

      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto px-4 pb-2 md:px-5">
        {filter && (
          <button type="button" aria-label="Clear filter" onClick={() => setFilter(null)} className="grid size-8 shrink-0 place-items-center rounded-full bg-highlight hover:bg-white/20">
            <X className="size-4" />
          </button>
        )}
        {filters
          .filter((option) => filter === null || filter === option.value)
          .map((option) => (
            <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(filter === option.value ? null : option.value)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-sm transition', filter === option.value ? 'bg-white text-black' : 'bg-highlight hover:bg-white/20')}>
              {option.label}
            </button>
          ))}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shows('playlists') && <LibraryItem to="/collection/tracks" source={{ type: 'liked' }} artwork={<LikedSongsArtwork className="size-12 rounded" />} title="Liked Songs" subtitle={`Playlist • ${pluralize(starred?.song?.length ?? 0, 'song')}`} />}
        {shows('playlists') &&
          playlists.map((playlist) => (
            <LibraryItem key={playlist.id} to={`/playlist/${playlist.id}`} source={{ type: 'playlist', id: playlist.id }} artwork={<CoverArt coverArtId={playlist.songCount > 0 ? playlist.coverArt : undefined} size={96} kind="playlist" className="size-12 rounded" />} title={playlist.name} subtitle={`Playlist • ${playlist.owner ?? ''}`} />
          ))}
        {shows('albums') && starred?.album?.map((album) => <LibraryItem key={album.id} to={`/album/${album.id}`} source={{ type: 'album', id: album.id }} artwork={<CoverArt coverArtId={album.coverArt} size={96} className="size-12 rounded" />} title={album.name} subtitle={`Album • ${album.artist ?? ''}`} />)}
        {shows('artists') && starred?.artist?.map((artist) => <LibraryItem key={artist.id} to={`/artist/${artist.id}`} source={{ type: 'artist', id: artist.id }} artwork={<CoverArt coverArtId={artist.coverArt ?? artist.id} size={96} kind="artist" className="size-12 rounded-full" />} title={artist.name} subtitle="Artist" />)}
      {filter === 'downloaded' && downloaded.map((collection) => <LibraryItem key={collection.key} to={collectionPath(collection)} source={{ type: collection.type, id: collection.type === 'liked' ? undefined : collection.id }} artwork={collection.type === 'liked' ? <LikedSongsArtwork className="size-12 rounded" /> : <CoverArt coverArtId={collection.coverArt} size={96} kind={collection.type === 'playlist' ? 'playlist' : 'album'} className="size-12 rounded" />} title={collection.name} subtitle={`${collection.type === 'album' ? 'Album' : 'Playlist'} • Downloaded`} />)}
      </ul>

      {shows('playlists') && playlists.length === 0 && (
        <div className="m-2 rounded-lg bg-elevated p-5">
          <p className="font-bold">Create your first playlist</p>
          <p className="mt-1 text-sm">It's easy, we'll help you.</p>
          <button type="button" disabled={creating} onClick={() => void handleCreate()} className="mt-4 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
            Create playlist
          </button>
        </div>
      )}
    </div>
  )
}

function LibraryItem({ to, source, artwork, title, subtitle }: { to: string; source: Pick<PlaySource, 'type' | 'id'>; artwork: ReactNode; title: string; subtitle: string }) {
  const playing = usePlayerStore((state) => state.isPlaying && isSameSource(state.source, source))
  return (
    <li>
      <NavLink to={to} end className={({ isActive }) => clsx('flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-highlight', isActive && 'bg-highlight')}>
        {artwork}
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate', playing ? 'text-accent' : 'text-white')}>{title}</span>
          <span className="block truncate text-sm text-subdued">{subtitle}</span>
        </span>
        {playing && <Volume2 className="size-4 shrink-0 text-accent" aria-label="Playing" />}
      </NavLink>
    </li>
  )
}
