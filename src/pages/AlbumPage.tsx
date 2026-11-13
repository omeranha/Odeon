import { Disc3, ListEnd, ListPlus, User } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { DropdownMenu } from '../components/DropdownMenu'
import { LoadingState, MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import { showToast } from '../components/toastStore'
import { formatTotalDuration, pluralize } from '../lib/format'
import { useDominantColor } from '../lib/hooks'
import type { AlbumWithSongs } from '../lib/subsonic/types'
import { AlbumCard, CoverArt, Shelf } from '../features/library/cards'
import { DownloadButton } from '../features/downloads/DownloadButton'
import { CollectionPage, MetaSeparator, ShuffleToggle } from '../features/library/CollectionPage'
import { LikeButton } from '../features/library/LikeButton'
import { useAlbum, useArtist, useCoverArtUrl } from '../features/library/queries'
import { TrackList } from '../features/library/TrackList'
import { useCollectionPlayback } from '../features/player/playback'
import { usePlayerStore } from '../features/player/playerStore'
import { useAddToPlaylistStore } from '../features/playlists/addToPlaylistStore'

const COVER_SIZE = 600

export function AlbumPage() {
  const { id = '' } = useParams()
  const { data: album, isPending, isError } = useAlbum(id)
  if (isPending) return <LoadingState />
  if (isError) return <MessageState icon={<Disc3 className="size-12 text-subdued" />} title="Couldn't load this album" message="Check your connection and try again." />
  return <AlbumView key={album.id} album={album} />
}

function AlbumView({ album }: { album: AlbumWithSongs }) {
  const navigate = useNavigate()
  const songs = album.song ?? []
  const color = useDominantColor(useCoverArtUrl(album.coverArt, COVER_SIZE))
  const source = { type: 'album' as const, id: album.id, name: album.name }
  const playback = useCollectionPlayback(source, songs)
  const openAddToPlaylist = useAddToPlaylistStore((state) => state.open)
  const totalDuration = songs.reduce((sum, song) => sum + (song.duration ?? 0), 0)

  return (
    <CollectionPage
      color={color}
      artwork={<CoverArt coverArtId={album.coverArt} size={COVER_SIZE} className="size-full" />}
      label="Album"
      title={album.name}
      meta={
        <>
          {album.artistId ? <Link to={`/artist/${album.artistId}`}>{album.artist}</Link> : <span className="font-bold text-white">{album.artist}</span>}
          {album.year && (
            <>
              <MetaSeparator />
              <span>{album.year}</span>
            </>
          )}
          <MetaSeparator />
          <span>
            {pluralize(songs.length, 'song')}, {formatTotalDuration(totalDuration)}
          </span>
        </>
      }
      actions={
        <>
          <PlayButton playing={playback.playing} label={album.name} size="lg" onClick={playback.toggle} />
          <ShuffleToggle />
          <LikeButton kind="album" item={album} size="lg" />
          {songs.length > 0 && <DownloadButton type="album" id={album.id} name={album.name} coverArt={album.coverArt} songs={songs} snapshot={album} />}
          <DropdownMenu
            label={`More options for ${album.name}`}
            className="[&_svg]:size-7"
            items={[
              songs.length > 0 && { label: 'Add to playlist', icon: ListPlus, onSelect: () => openAddToPlaylist(songs) },
              songs.length > 0 && {
                label: 'Add to queue',
                icon: ListEnd,
                onSelect: () => {
                  usePlayerStore.getState().addToQueue(songs)
                  showToast('Added to queue')
                },
              },
              album.artistId ? { label: 'Go to artist', icon: User, onSelect: () => navigate(`/artist/${album.artistId}`) } : null,
            ]}
          />
        </>
      }
    >
      <TrackList songs={songs} source={source} useTrackNumbers groupByDisc />
      {album.artistId && <MoreByArtist artistId={album.artistId} currentAlbumId={album.id} />}
    </CollectionPage>
  )
}

function MoreByArtist({ artistId, currentAlbumId }: { artistId: string; currentAlbumId: string }) {
  const { data: artist } = useArtist(artistId)
  const albums = (artist?.album ?? []).filter((album) => album.id !== currentAlbumId)
  if (!artist || albums.length === 0) return null

  return (
    <div className="mt-10">
      <Shelf title={`More by ${artist.name}`}>
        {albums.map((album) => (
          <AlbumCard key={album.id} album={album} subtitle={album.year ? String(album.year) : 'Album'} />
        ))}
      </Shelf>
    </div>
  )
}
