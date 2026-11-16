import clsx from 'clsx'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { LoadingState, MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import { useDebouncedValue } from '../lib/hooks'
import type { SearchResults, SubsonicPlaylist, SubsonicSong } from '../lib/subsonic/types'
import { AlbumCard, ArtistCard, CardGrid, CoverArt, PlaylistCard, Shelf, SongCover } from '../features/library/cards'
import { useCredentials, usePlaylists, useSearch } from '../features/library/queries'
import { TrackList } from '../features/library/TrackList'
import { primeAudio } from '../features/player/audioEngine'
import { prefetchStream } from '../features/player/prefetch'
import { useIsSourcePlaying, usePlayRemoteCollection } from '../features/player/playback'
import { usePlayerStore } from '../features/player/playerStore'
import { CatalogResults } from '../features/getMusic/CatalogResults'
import { useCatalogSearch, useGetMusicEnabled } from '../features/getMusic/hooks'
import { useRecentSearches, useRecordSearch } from '../features/history/hooks'
import { RecentSearches } from '../features/history/RecentSearches'
import { SimilarSongsSection } from '../features/recommendations/SimilarSongsSection'
import { mergeSources } from '../features/recommendations/similar'
import { organizeSearchSongs } from '../features/recommendations/versions'
import { catalogTrackToSong, isMusicLink } from '../lib/downtify'

type Filter = 'all' | 'songs' | 'artists' | 'albums' | 'playlists'

// Looking a song up takes the server a fraction of a second, so the top results are ready before one is chosen.
const PREFETCH_RESULTS = 3
const PREFETCH_DELAY_MS = 400

const filterOptions: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
  { value: 'playlists', label: 'Playlists' },
]

const searchSource = { type: 'search' as const, name: 'Search' }
const noResults: SearchResults = { artists: [], albums: [], songs: [] }

export function SearchPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const credentials = useCredentials()
  const query = searchParams.get('q') ?? ''
  const debouncedQuery = useDebouncedValue(query, 300)
  const { data: results, isPending, isError } = useSearch(debouncedQuery)
  const { data: playlists = [] } = usePlaylists()
  const [filter, setFilter] = useState<Filter>('all')
  const getMusicEnabled = useGetMusicEnabled()
  const catalogQuery = useDebouncedValue(query, 600)
  const { data: recentSearches } = useRecentSearches()
  useRecordSearch(query)
  const showLink = getMusicEnabled && isMusicLink(query)
  const catalog = useCatalogSearch(catalogQuery, getMusicEnabled && !showLink)
  const term = debouncedQuery.trim().toLowerCase()
  const matchingPlaylists = term ? playlists.filter((playlist) => playlist.name.toLowerCase().includes(term)) : []
  const library = results ?? noResults
  const catalogTracks = !catalog.link ? catalog.data : undefined
  const catalogSongs = useMemo(() => (catalogTracks ?? []).map((track) => catalogTrackToSong(credentials, track)), [catalogTracks, credentials])
  const catalogPending = getMusicEnabled && !showLink && catalogQuery.trim().length >= 2 && (catalog.isPending || catalogQuery !== query)

  function handleQueryChange(value: string) {
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/search', { replace: true })
  }

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 bg-surface px-4 pt-4 pb-3 md:hidden">
        <h1 className="mb-4 text-2xl font-bold">Search</h1>
        <label className="flex h-12 items-center gap-3 rounded-md bg-white px-3 text-black">
          <Search className="size-6" />
          <input type="search" value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="What do you want to listen to?" className="w-full bg-transparent text-base font-medium outline-none placeholder:text-neutral-600" />
        </label>
      </div>

      {!term ? (
        recentSearches?.length ? (
          <div className="pt-4 md:pt-6">
            <RecentSearches />
          </div>
        ) : (
          <MessageState title="Play what you love" message="Search for artists, albums, songs and playlists." />
        )
      ) : showLink ? (
        <div className="pt-2 md:pt-6">
          <CatalogResults query={catalogQuery} />
        </div>
      ) : (
        <>
          <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pt-2 pb-4 md:px-6 md:pt-6">
            {filterOptions.map((option) => (
              <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-sm transition', filter === option.value ? 'bg-white text-black' : 'bg-highlight hover:bg-white/20')}>
                {option.label}
              </button>
            ))}
          </div>
          {isPending && !results ? (
            <LoadingState />
          ) : isError && !getMusicEnabled ? (
            <MessageState title="Search failed" message="Check your connection and try again." />
          ) : (
            <Results results={library} extraSongs={catalogSongs} extraPending={catalogPending} playlists={matchingPlaylists} filter={filter} query={debouncedQuery} />
          )}
        </>
      )}
    </div>
  )
}

function Results({ results, extraSongs, extraPending, playlists, filter, query }: { results: SearchResults; extraSongs: SubsonicSong[]; extraPending: boolean; playlists: SubsonicPlaylist[]; filter: Filter; query: string }) {
  const { main: songs, more: otherVersions } = useMemo(() => organizeSearchSongs(mergeSources(results.songs, extraSongs), query), [results.songs, extraSongs, query])
  useEffect(() => {
    if (extraPending) return
    const timer = setTimeout(() => songs.slice(0, 6).filter((song) => song.external).slice(0, PREFETCH_RESULTS).forEach((song) => prefetchStream(song.external?.streamUrl)), PREFETCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [songs, extraPending])
  const counts: Record<Filter, number> = { all: songs.length + results.artists.length + results.albums.length + playlists.length, songs: songs.length, artists: results.artists.length, albums: results.albums.length, playlists: playlists.length }
  if (counts[filter] === 0) {
    if (extraPending && (filter === 'all' || filter === 'songs')) return <LoadingState />
    return <MessageState title={`No results found for "${query}"`} message="Check the spelling, or try fewer or different keywords." />
  }

  if (filter === 'songs') {
    return (
      <>
        <TrackList songs={songs} source={searchSource} showAlbum showCover />
        <OtherVersions songs={otherVersions} />
      </>
    )
  }
  if (filter === 'artists') return <CardGrid>{results.artists.map((artist) => <ArtistCard key={artist.id} artist={artist} fluid />)}</CardGrid>
  if (filter === 'albums') return <CardGrid>{results.albums.map((album) => <AlbumCard key={album.id} album={album} fluid />)}</CardGrid>
  if (filter === 'playlists') return <CardGrid>{playlists.map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} fluid />)}</CardGrid>

  return (
    <>
      <div className="mb-6 grid gap-6 px-4 md:px-6 lg:grid-cols-[2fr_3fr]">
        <TopResult results={results} song={songs[0]} />
        {songs.length > 0 && (
          <section className="min-w-0">
            <h2 className="mb-2 text-xl font-bold md:text-2xl">Songs</h2>
            <div className="-mx-4">
              <TrackList songs={songs.slice(0, 4)} source={searchSource} showCover showHeader={false} />
            </div>
          </section>
        )}
      </div>
      <OtherVersions songs={otherVersions} />
      {songs[0] && <SimilarSongsSection seed={songs[0]} exclude={songs} />}
      {results.artists.length > 0 && (
        <Shelf title="Artists">
          {results.artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </Shelf>
      )}
      {results.albums.length > 0 && (
        <Shelf title="Albums">
          {results.albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </Shelf>
      )}
      {playlists.length > 0 && (
        <Shelf title="Playlists">
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </Shelf>
      )}
    </>
  )
}

// Remixes, covers, karaoke and the like that the search did not ask for, one tap away instead of mixed into the results.
function OtherVersions({ songs }: { songs: SubsonicSong[] }) {
  const [open, setOpen] = useState(false)
  if (songs.length === 0) return null
  return (
    <section className="mb-6 px-4 md:px-6">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-full border border-white/40 px-4 py-1.5 text-sm font-bold transition hover:scale-105 hover:border-white">
        {open ? 'Hide other versions' : `Show ${songs.length} other ${songs.length === 1 ? 'version' : 'versions'}`}
      </button>
      {open && (
        <div className="-mx-4 mt-3 md:-mx-6">
          <TrackList songs={songs} source={searchSource} showCover showHeader={false} />
        </div>
      )}
    </section>
  )
}

function TopResult({ results, song }: { results: SearchResults; song?: SubsonicSong }) {
  const artist = results.artists[0]
  const album = results.albums[0]
  const albumSource = { type: 'album' as const, id: album?.id ?? '', name: album?.name ?? '' }
  const albumPlaying = useIsSourcePlaying(albumSource)
  const playCollection = usePlayRemoteCollection()

  const cardClass = 'group relative flex flex-col gap-4 rounded-lg bg-white/5 p-5 transition-colors hover:bg-white/10'
  const heading = <h2 className="mb-2 text-xl font-bold md:text-2xl">Top result</h2>

  if (artist) {
    return (
      <section>
        {heading}
        <Link to={`/artist/${artist.id}`} className={cardClass}>
          <CoverArt coverArtId={artist.coverArt ?? artist.id} size={200} kind="artist" className="size-24 rounded-full shadow-lg" />
          <div>
            <p className="truncate text-3xl font-bold">{artist.name}</p>
            <p className="mt-1 text-sm text-subdued">Artist</p>
          </div>
        </Link>
      </section>
    )
  }

  if (album) {
    return (
      <section>
        {heading}
        <Link to={`/album/${album.id}`} className={cardClass}>
          <CoverArt coverArtId={album.coverArt} size={200} className="size-24 rounded shadow-lg" />
          <div>
            <p className="truncate text-3xl font-bold">{album.name}</p>
            <p className="mt-1 text-sm text-subdued">Album • {album.artist}</p>
          </div>
          <span className="absolute right-5 bottom-5 hidden md:block">
            <PlayButton playing={albumPlaying} label={album.name} onClick={() => void playCollection(albumSource)} />
          </span>
        </Link>
      </section>
    )
  }

  if (!song) return null
  return (
    <section>
      {heading}
      <button
        type="button"
        onClick={() => {
          primeAudio()
          usePlayerStore.getState().playQueue([song], 0, searchSource)
        }}
        className={clsx(cardClass, 'w-full text-left')}
      >
        <SongCover song={song} size={200} className="size-24 rounded shadow-lg" />
        <div className="min-w-0">
          <p className="truncate text-3xl font-bold">{song.title}</p>
          <p className="mt-1 text-sm text-subdued">Song • {song.artist}</p>
        </div>
      </button>
    </section>
  )
}
