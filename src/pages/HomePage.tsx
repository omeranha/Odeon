import { FolderOpen, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import type { AlbumListType, SubsonicAlbum, SubsonicPlaylist } from '../lib/subsonic/types'
import { DownloadedCollections } from '../features/downloads/DownloadedCollections'
import { useOnline } from '../features/downloads/hooks'
import { AlbumCard, CardSkeleton, CoverArt, PlaylistCard, Shelf } from '../features/library/cards'
import { useAlbumList, usePlaylists } from '../features/library/queries'
import { recentPlaylistIds } from '../features/player/history'
import { useIsSourcePlaying, usePlayRemoteCollection } from '../features/player/playback'
import { ProfileMenu } from '../features/profiles/ProfileMenu'
import { interleave } from '../features/recommendations/similar'

const shelves: { title: string; type: AlbumListType }[] = [
  { title: 'Recently added', type: 'newest' },
  { title: 'Your top albums', type: 'frequent' },
  { title: 'Discover something random', type: 'random' },
]

const QUICK_ACCESS_COUNT = 8
const JUMP_BACK_IN_COUNT = 16

type JumpBackInItem = { kind: 'album'; album: SubsonicAlbum } | { kind: 'playlist'; playlist: SubsonicPlaylist }

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Played playlists come first, newest play first; the ones never played follow, by last change.
function sortPlaylists(playlists: SubsonicPlaylist[], playedIds: string[]): SubsonicPlaylist[] {
  const rank = new Map(playedIds.map((id, index) => [id, index]))
  return [...playlists].sort((a, b) => {
    const rankA = rank.get(a.id)
    const rankB = rank.get(b.id)
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    return b.changed.localeCompare(a.changed)
  })
}

export function HomePage() {
  const [greeting] = useState(() => greetingFor(new Date().getHours()))
  const [playedIds] = useState(recentPlaylistIds)
  const newest = useAlbumList('newest', 12)
  const { data: playlists } = usePlaylists()
  const online = useOnline()
  const libraryIsEmpty = newest.data?.length === 0
  const offline = !online || (newest.isError && !newest.data)
  const sorted = useMemo(() => sortPlaylists(playlists ?? [], playedIds), [playlists, playedIds])

  return (
    <div className="min-h-full bg-gradient-to-b from-accent/20 via-surface to-surface to-[320px] pb-8">
      <header className="flex items-center gap-3 px-4 pt-4 pb-4 md:px-6 md:pt-6">
        <div className="md:hidden">
          <ProfileMenu align="left" />
        </div>
        <h1 className="text-2xl font-bold md:text-3xl">{greeting}</h1>
      </header>

      {offline ? (
        <section>
          <div className="mx-4 mb-6 flex items-center gap-3 rounded-lg bg-elevated p-4 md:mx-6">
            <WifiOff className="size-6 shrink-0 text-subdued" />
            <div>
              <p className="font-bold">You're offline</p>
              <p className="text-sm text-subdued">Only your downloads are available until the connection comes back.</p>
            </div>
          </div>
          <h2 className="mb-1 px-4 text-xl font-bold md:px-6 md:text-2xl">Your downloads</h2>
          <DownloadedCollections />
        </section>
      ) : libraryIsEmpty ? (
        <MessageState icon={<FolderOpen className="size-12 text-subdued" />} title="Your library is empty" message="Add music to the Navidrome library folder and it will show up here after the next scan." />
      ) : (
        <>
          <RecentPlaylists playlists={sorted.slice(0, QUICK_ACCESS_COUNT)} />
          <JumpBackIn playlists={sorted.slice(QUICK_ACCESS_COUNT)} />
          {shelves.map((shelf) => (
            <AlbumShelf key={shelf.type} {...shelf} />
          ))}
        </>
      )}
    </div>
  )
}

function RecentPlaylists({ playlists }: { playlists: SubsonicPlaylist[] }) {
  if (playlists.length === 0) return null

  return (
    <div className="mb-8 grid grid-cols-2 gap-2 px-4 md:px-6 lg:grid-cols-4">
      {playlists.map((playlist) => (
        <PlaylistTile key={playlist.id} playlist={playlist} />
      ))}
    </div>
  )
}

function PlaylistTile({ playlist }: { playlist: SubsonicPlaylist }) {
  const source = { type: 'playlist' as const, id: playlist.id, name: playlist.name }
  const playing = useIsSourcePlaying(source)
  const playCollection = usePlayRemoteCollection()

  return (
    <Link to={`/playlist/${playlist.id}`} className="group flex h-14 items-center gap-3 overflow-hidden rounded bg-white/10 pr-2 transition-colors hover:bg-white/20 md:h-16">
      <CoverArt coverArtId={playlist.coverArt} kind="playlist" size={128} className="aspect-square h-full" />
      <span className="line-clamp-2 flex-1 text-xs font-bold md:text-sm">{playlist.name}</span>
      {playlist.songCount > 0 && (
        <span className={playing ? 'hidden md:block' : 'hidden opacity-0 transition group-hover:opacity-100 md:block'}>
          <PlayButton playing={playing} label={playlist.name} size="sm" onClick={() => void playCollection(source)} />
        </span>
      )}
    </Link>
  )
}

// Albums from what was played lately, mixed with playlists that were not among the latest ones.
function JumpBackIn({ playlists }: { playlists: SubsonicPlaylist[] }) {
  const { data: albums, isPending } = useAlbumList('recent', 12)
  const items = useMemo(
    () =>
      interleave<JumpBackInItem>([
        (albums ?? []).map((album) => ({ kind: 'album', album })),
        playlists.map((playlist) => ({ kind: 'playlist', playlist })),
      ]).slice(0, JUMP_BACK_IN_COUNT),
    [albums, playlists],
  )
  if (!isPending && items.length === 0) return null

  return (
    <Shelf title="Jump back in">
      {isPending && items.length === 0
        ? Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />)
        : items.map((item) => (item.kind === 'album' ? <AlbumCard key={`album-${item.album.id}`} album={item.album} /> : <PlaylistCard key={`playlist-${item.playlist.id}`} playlist={item.playlist} />))}
    </Shelf>
  )
}

function AlbumShelf({ title, type }: { title: string; type: AlbumListType }) {
  const { data, isPending, isError } = useAlbumList(type, 12)
  if (isError || data?.length === 0) return null

  return <Shelf title={title}>{isPending ? Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />) : data.map((album) => <AlbumCard key={album.id} album={album} />)}</Shelf>
}
