import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useGetMusicEnabled } from '../getMusic/hooks'
import { useCredentials } from '../library/queries'
import { TrackList } from '../library/TrackList'
import { fitToSeeds, similarSongs, withoutKnown } from './similar'

const VISIBLE = 6
// The row shouldn't wait long for the language check; songs it hasn't reached are checked by the next search.
const SEARCH_FIT_BUDGET_MS = 2_000

function useSimilarSongs(seed: SubsonicSong | undefined, count: number) {
  const credentials = useCredentials()
  const catalogEnabled = useGetMusicEnabled()
  return useQuery({
    queryKey: ['similar', seed?.id ?? '', count, catalogEnabled],
    queryFn: ({ signal }) => similarSongs({ credentials, catalogEnabled }, seed!, count, signal).then((songs) => fitToSeeds(credentials, [seed!], songs, { signal, budgetMs: SEARCH_FIT_BUDGET_MS })),
    enabled: Boolean(seed),
    staleTime: 30 * 60 * 1000,
  })
}

// Appears once its songs have loaded, so the results above it don't move while it fetches.
export function SimilarSongsSection({ seed, exclude }: { seed: SubsonicSong; exclude: SubsonicSong[] }) {
  const { data } = useSimilarSongs(seed, 20)
  const songs = useMemo(() => withoutKnown(data ?? [], exclude).slice(0, VISIBLE), [data, exclude])
  if (songs.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 truncate px-4 text-xl font-bold md:px-6 md:text-2xl">Similar to {seed.title}</h2>
      <TrackList songs={songs} source={{ type: 'search', name: `Similar to ${seed.title}` }} showAlbum showCover showHeader={false} />
    </section>
  )
}
