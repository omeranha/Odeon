import { useEffect, useRef } from 'react'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useGetMusicEnabled } from '../getMusic/hooks'
import { useCredentials } from '../library/queries'
import { usePlayerStore } from '../player/playerStore'
import { useCurrentProfile } from '../profiles/profileStore'
import { fitToSeeds, interleave, similarSongs, withoutKnown, type SimilarContext } from './similar'

const AUTOPLAY_COUNT = 20
const AUTOPLAY_SEEDS = 2
const SMART_EVERY = 3
const SMART_MAX = 30
const SMART_SEEDS = 5
const SMART_PER_SEED = 15
// How many queue songs the candidates are judged against: the last ones played for autoplay, a sample of the
// playlist (five times this) for smart shuffle.
const FIT_SEEDS = 10

type PlayerState = ReturnType<typeof usePlayerStore.getState>

function sample<T>(items: T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (picked.length < count && pool.length > 0) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return picked
}

// A song similar to several of the playlist's songs fits the playlist better than one similar to a single song.
function rankBySharedSeeds(lists: SubsonicSong[][]): SubsonicSong[] {
  const scores = new Map<string, { song: SubsonicSong; seeds: number; bestRank: number }>()
  for (const list of lists) {
    list.forEach((song, rank) => {
      const entry = scores.get(song.id)
      if (entry) {
        entry.seeds++
        entry.bestRank = Math.min(entry.bestRank, rank)
      } else scores.set(song.id, { song, seeds: 1, bestRank: rank })
    })
  }
  return [...scores.values()].sort((a, b) => b.seeds - a.seeds || a.bestRank - b.bestRank).map((entry) => entry.song)
}

async function autoplaySongs(context: SimilarContext, state: PlayerState): Promise<SubsonicSong[]> {
  const seeds = state.queue.slice(-AUTOPLAY_SEEDS).reverse()
  const lists = await Promise.all(seeds.map((seed) => similarSongs(context, seed, AUTOPLAY_COUNT).catch(() => [])))
  const fitting = await fitToSeeds(context.credentials, state.queue.slice(-FIT_SEEDS), withoutKnown(interleave(lists), state.queue))
  return fitting.slice(0, AUTOPLAY_COUNT).map((song) => ({ ...song, suggested: 'autoplay' as const }))
}

async function smartShuffleSongs(context: SimilarContext, state: PlayerState): Promise<SubsonicSong[]> {
  const own = (state.originalQueue ?? state.queue).filter((song) => !song.suggested)
  const lists = await Promise.all(sample(own, SMART_SEEDS).map((seed) => similarSongs(context, seed, SMART_PER_SEED).catch(() => [])))
  const upcoming = state.queue.length - state.currentIndex - 1
  const fitting = await fitToSeeds(context.credentials, sample(own, FIT_SEEDS * 5), withoutKnown(rankBySharedSeeds(lists), state.queue))
  return fitting.slice(0, Math.min(SMART_MAX, Math.ceil(upcoming / SMART_EVERY))).map((song) => ({ ...song, suggested: 'smart' as const }))
}

// Autoplay: when the last song in the queue starts, similar songs are added after it so the music doesn't stop.
// Smart shuffle: while it's on, similar songs are mixed into the shuffled queue, one after every few songs.
export function useQueueSuggestions() {
  const credentials = useCredentials()
  const catalogEnabled = useGetMusicEnabled()
  const autoplay = useCurrentProfile().settings.autoplay !== false
  const options = useRef({ context: { credentials, catalogEnabled }, autoplay })
  useEffect(() => {
    options.current = { context: { credentials, catalogEnabled }, autoplay }
  }, [credentials, catalogEnabled, autoplay])

  useEffect(() => {
    let disposed = false
    // Each queue is tried once, so a song without suggestions doesn't trigger a request on every state change.
    const attempted = new Set<string>()

    const check = (state: PlayerState) => {
      const current = state.queue[state.currentIndex]
      if (options.current.autoplay && current && state.repeat === 'off' && state.currentIndex === state.queue.length - 1) {
        const key = `autoplay\n${current.id}\n${state.queue.length}`
        if (!attempted.has(key)) {
          attempted.add(key)
          void autoplaySongs(options.current.context, state).then((songs) => {
            const now = usePlayerStore.getState()
            if (!disposed && now.queue[now.queue.length - 1] === current) now.appendSuggestions(songs)
          })
        }
      }

      if (!state.smartShuffle) {
        if (state.queue.some((song, index) => song.suggested === 'smart' && index !== state.currentIndex)) state.removeSmartSuggestions()
        return
      }
      const upcoming = state.queue.slice(state.currentIndex + 1)
      if (upcoming.length < SMART_EVERY || upcoming.some((song) => song.suggested === 'smart')) return
      const base = state.originalQueue
      const key = `smart\n${state.source?.type}\n${state.source?.id}\n${base?.length}\n${base?.[0]?.id}`
      if (attempted.has(key)) return
      attempted.add(key)
      void smartShuffleSongs(options.current.context, state).then((songs) => {
        const now = usePlayerStore.getState()
        if (!disposed && now.smartShuffle && now.originalQueue === base) now.insertSmartSuggestions(songs, SMART_EVERY)
      })
    }

    check(usePlayerStore.getState())
    const unsubscribe = usePlayerStore.subscribe(check)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])
}
