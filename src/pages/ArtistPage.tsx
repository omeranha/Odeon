import clsx from 'clsx'
import { User } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { LoadingState, MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import { showToast } from '../components/toastStore'
import { pluralize } from '../lib/format'
import { useDominantColor } from '../lib/hooks'
import type { ArtistWithAlbums } from '../lib/subsonic/types'
import { AlbumCard, ArtistCard, CoverArt, Shelf } from '../features/library/cards'
import { CollectionPage, ShuffleToggle } from '../features/library/CollectionPage'
import { useArtist, useArtistInfo, useCoverArtUrl, useLibraryFetchers, useTopSongs } from '../features/library/queries'
import { useIsStarred, useToggleStar } from '../features/library/stars'
import { TrackList } from '../features/library/TrackList'
import { primeAudio } from '../features/player/audioEngine'
import { useIsSourcePlaying } from '../features/player/playback'
import { isSameSource, usePlayerStore } from '../features/player/playerStore'

const IMAGE_SIZE = 600

export function ArtistPage() {
  const { id = '' } = useParams()
  const { data: artist, isPending, isError } = useArtist(id)
  if (isPending) return <LoadingState />
  if (isError || !artist) return <MessageState icon={<User className="size-12 text-subdued" />} title="Couldn't load this artist" message="Check your connection and try again." />
  return <ArtistView key={artist.id} artist={artist} />
}

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
}

function ArtistView({ artist }: { artist: ArtistWithAlbums }) {
  const { data: info } = useArtistInfo(artist.id)
  const { data: topSongs = [] } = useTopSongs(artist.name)
  const fetchers = useLibraryFetchers()
  const [showAllPopular, setShowAllPopular] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const coverArtId = artist.coverArt ?? artist.id
  const color = useDominantColor(useCoverArtUrl(coverArtId, IMAGE_SIZE))
  const source = { type: 'artist' as const, id: artist.id, name: artist.name }
  const playing = useIsSourcePlaying(source)
  const albums = [...(artist.album ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  const similarArtists = (info?.similarArtist ?? []).filter((similar) => similar.id)
  const biography = info?.biography ? plainText(info.biography) : ''

  async function handlePlay() {
    const store = usePlayerStore.getState()
    if (isSameSource(store.source, source)) {
      store.togglePlay()
      return
    }
    primeAudio()
    let songs = topSongs
    if (songs.length === 0) {
      try {
        const fullAlbums = await Promise.all(albums.map((album) => fetchers.album(album.id)))
        songs = fullAlbums.flatMap((album) => album.song ?? [])
      } catch {
        showToast("Couldn't start playback. Try again.")
        return
      }
    }
    usePlayerStore.getState().playQueue(songs, null, source)
  }

  return (
    <CollectionPage
      color={color}
      artwork={<CoverArt coverArtId={coverArtId} size={IMAGE_SIZE} kind="artist" className="size-full" />}
      roundArtwork
      label="Artist"
      title={artist.name}
      meta={<span>{pluralize(artist.albumCount ?? albums.length, 'album')}</span>}
      actions={
        <>
          <PlayButton playing={playing} label={artist.name} size="lg" onClick={() => void handlePlay()} />
          <ShuffleToggle />
          <FollowButton artistId={artist.id} starred={artist.starred} />
        </>
      }
    >
      {topSongs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 px-4 text-xl font-bold md:px-6 md:text-2xl">Popular</h2>
          <TrackList songs={showAllPopular ? topSongs : topSongs.slice(0, 5)} source={source} showCover showHeader={false} />
          {topSongs.length > 5 && (
            <button type="button" onClick={() => setShowAllPopular(!showAllPopular)} className="mt-2 px-4 text-sm font-bold text-subdued hover:text-white md:px-8">
              {showAllPopular ? 'Show less' : 'See more'}
            </button>
          )}
        </section>
      )}

      {albums.length > 0 && (
        <Shelf title="Discography">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} subtitle={album.year ? String(album.year) : 'Album'} />
          ))}
        </Shelf>
      )}

      {similarArtists.length > 0 && (
        <Shelf title="Fans also like">
          {similarArtists.map((similar) => (
            <ArtistCard key={similar.id} artist={similar} />
          ))}
        </Shelf>
      )}

      {biography && (
        <section className="mx-4 mt-4 max-w-3xl rounded-lg bg-elevated p-6 md:mx-6">
          <h2 className="mb-3 text-xl font-bold md:text-2xl">About</h2>
          <p className={clsx('text-sm whitespace-pre-line text-subdued', !bioExpanded && 'line-clamp-4')}>{biography}</p>
          <button type="button" onClick={() => setBioExpanded(!bioExpanded)} className="mt-2 text-sm font-bold hover:underline">
            {bioExpanded ? 'Show less' : 'Read more'}
          </button>
        </section>
      )}
    </CollectionPage>
  )
}

function FollowButton({ artistId, starred }: { artistId: string; starred?: string }) {
  const following = useIsStarred({ id: artistId, starred })
  const toggleStar = useToggleStar()
  return (
    <button type="button" aria-pressed={following} onClick={() => void toggleStar('artist', artistId, !following)} className="rounded-full border border-white/50 px-4 py-1.5 text-sm font-bold transition hover:scale-105 hover:border-white">
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
