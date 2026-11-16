import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { recencyWeights } from './history'

export type RepeatMode = 'off' | 'all' | 'one'
export type PlaySourceType = 'album' | 'playlist' | 'artist' | 'liked' | 'search' | 'history'

export interface PlaySource {
  type: PlaySourceType
  id?: string
  name: string
}

interface PlayerState {
  queue: SubsonicSong[]
  originalQueue: SubsonicSong[] | null
  currentIndex: number
  queuedCount: number
  // Songs already played, oldest first, so "previous" goes back to what was actually heard, not to the neighbor in the queue.
  history: SubsonicSong[]
  source: PlaySource | null
  playbackId: number
  isPlaying: boolean
  shuffle: boolean
  // Shuffle that also mixes in similar songs, marked `suggested: 'smart'`. Only on while shuffle is.
  smartShuffle: boolean
  repeat: RepeatMode
  volume: number
  muted: boolean
  queueOpen: boolean
  lyricsOpen: boolean
  fullScreenOpen: boolean
  playQueue: (songs: SubsonicSong[], startIndex: number | null, source: PlaySource | null) => void
  setPlaying: (playing: boolean) => void
  togglePlay: () => void
  next: () => void
  previous: () => void
  jumpTo: (index: number) => void
  addToQueue: (songs: SubsonicSong[]) => void
  removeFromQueue: (index: number) => void
  toggleShuffle: () => void
  // Off, shuffle, smart shuffle, like Spotify's shuffle button.
  cycleShuffle: () => void
  appendSuggestions: (songs: SubsonicSong[]) => void
  insertSmartSuggestions: (songs: SubsonicSong[], every: number) => void
  removeSmartSuggestions: () => void
  cycleRepeat: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setQueueOpen: (open: boolean) => void
  setLyricsOpen: (open: boolean) => void
  setFullScreenOpen: (open: boolean) => void
  clear: () => void
}

const nextRepeatMode: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapWith]] = [result[swapWith], result[index]]
  }
  return result
}

// Like Spotify's shuffle: of several random orders, the one that plays recently heard songs latest is kept.
const SHUFFLE_CANDIDATES = 8

function freshShuffle(songs: SubsonicSong[]): SubsonicSong[] {
  const recency = recencyWeights()
  if (songs.length < 3 || recency.size === 0) return shuffled(songs)
  let best = songs
  let bestScore = Infinity
  for (let attempt = 0; attempt < SHUFFLE_CANDIDATES; attempt++) {
    const order = shuffled(songs)
    const score = order.reduce((sum, song, index) => sum + (recency.get(song.id) ?? 0) * (order.length - index), 0)
    if (score < bestScore) {
      best = order
      bestScore = score
    }
  }
  return best
}

function withoutFirst<T>(items: T[], item: T): T[] {
  const index = items.indexOf(item)
  return index === -1 ? items : [...items.slice(0, index), ...items.slice(index + 1)]
}

const HISTORY_LIMIT = 50

function rememberCurrent(state: Pick<PlayerState, 'queue' | 'currentIndex' | 'history'>): SubsonicSong[] {
  const current = state.queue[state.currentIndex]
  if (!current || state.history[state.history.length - 1]?.id === current.id) return state.history
  return [...state.history, current].slice(-HISTORY_LIMIT)
}

function indexForPrevious(queue: SubsonicSong[], songId: string, currentIndex: number): number {
  for (let index = currentIndex - 1; index >= 0; index--) if (queue[index].id === songId) return index
  return queue.findIndex((song) => song.id === songId)
}

type QueueFields = Pick<PlayerState, 'queue' | 'originalQueue' | 'currentIndex' | 'queuedCount' | 'shuffle' | 'smartShuffle'>

function shuffleOn(state: QueueFields): Partial<QueueFields> {
  const current = state.queue[state.currentIndex]
  if (!current) return { shuffle: true }
  return { shuffle: true, originalQueue: state.queue, queue: [current, ...freshShuffle(state.queue.slice(state.currentIndex + 1))], currentIndex: 0, queuedCount: 0 }
}

// Smart shuffle's songs were never in the original order, so restoring it drops them, except one that is playing now.
function shuffleOff(state: QueueFields): Partial<QueueFields> {
  const current = state.queue[state.currentIndex]
  if (!state.originalQueue || !current) return { shuffle: false, smartShuffle: false, originalQueue: null }
  const byReference = state.originalQueue.indexOf(current)
  const index = byReference !== -1 ? byReference : state.originalQueue.findIndex((song) => song.id === current.id)
  if (index === -1) return { shuffle: false, smartShuffle: false, queue: [current, ...state.originalQueue], originalQueue: null, currentIndex: 0, queuedCount: 0 }
  return { shuffle: false, smartShuffle: false, queue: state.originalQueue, originalQueue: null, currentIndex: index, queuedCount: 0 }
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      originalQueue: null,
      currentIndex: 0,
      queuedCount: 0,
      history: [],
      source: null,
      playbackId: 0,
      isPlaying: false,
      shuffle: false,
      smartShuffle: false,
      repeat: 'off',
      volume: 1,
      muted: false,
      queueOpen: false,
      lyricsOpen: false,
      fullScreenOpen: false,

      playQueue: (songs, startIndex, source) =>
        set((state) => {
          if (songs.length === 0) return {}
          const start = startIndex ?? (state.shuffle ? Math.floor(Math.random() * songs.length) : 0)
          const base = { source, queuedCount: 0, isPlaying: true, playbackId: state.playbackId + 1, history: rememberCurrent(state) }
          if (!state.shuffle) return { ...base, queue: songs, originalQueue: null, currentIndex: start }
          const rest = songs.filter((_, index) => index !== start)
          return { ...base, queue: [songs[start], ...freshShuffle(rest)], originalQueue: songs, currentIndex: 0 }
        }),

      setPlaying: (isPlaying) => set((state) => (state.queue.length > 0 ? { isPlaying } : {})),
      togglePlay: () => set((state) => (state.queue.length > 0 ? { isPlaying: !state.isPlaying } : {})),

      next: () =>
        set((state) => {
          if (state.queue.length === 0) return {}
          const history = rememberCurrent(state)
          const atEnd = state.currentIndex >= state.queue.length - 1
          if (atEnd && state.repeat === 'off') return { currentIndex: 0, queuedCount: 0, isPlaying: false, playbackId: state.playbackId + 1, history }
          return { currentIndex: atEnd ? 0 : state.currentIndex + 1, queuedCount: Math.max(0, state.queuedCount - 1), playbackId: state.playbackId + 1, history }
        }),

      previous: () =>
        set((state) => {
          if (state.queue.length === 0) return {}
          const current = state.queue[state.currentIndex]
          const history = [...state.history]
          while (history.length > 0 && history[history.length - 1].id === current?.id) history.pop()
          const played = history.pop()
          if (played) {
            const index = indexForPrevious(state.queue, played.id, state.currentIndex)
            const playbackId = state.playbackId + 1
            if (index !== -1) return { history, currentIndex: index, queuedCount: index > state.currentIndex ? Math.max(0, state.currentIndex + state.queuedCount - index) : 0, playbackId }
            // Not in the queue any more (another list was played since): it goes back in just before the current song.
            const queue = [...state.queue.slice(0, state.currentIndex), played, ...state.queue.slice(state.currentIndex)]
            return { history, queue, queuedCount: state.queuedCount + 1, playbackId }
          }
          // Search results have no order worth stepping back through, so with nothing played before, the song restarts.
          if (state.source?.type === 'search') return { history, playbackId: state.playbackId + 1 }
          const atStart = state.currentIndex === 0
          const index = atStart ? (state.repeat === 'all' ? state.queue.length - 1 : 0) : state.currentIndex - 1
          return { history, currentIndex: index, playbackId: state.playbackId + 1 }
        }),

      jumpTo: (index) =>
        set((state) => {
          if (index < 0 || index >= state.queue.length) return {}
          const queuedCount = index > state.currentIndex ? Math.max(0, state.currentIndex + state.queuedCount - index) : 0
          return { currentIndex: index, queuedCount, isPlaying: true, playbackId: state.playbackId + 1, history: rememberCurrent(state) }
        }),

      // Like Spotify, queued songs play right after the current one, ahead of the rest of the album or playlist.
      addToQueue: (songs) =>
        set((state) => {
          if (songs.length === 0) return {}
          if (state.queue.length === 0) return { queue: songs, originalQueue: null, currentIndex: 0, queuedCount: 0, source: null, isPlaying: false, playbackId: state.playbackId + 1 }
          const insertAt = state.currentIndex + 1 + state.queuedCount
          return {
            queue: [...state.queue.slice(0, insertAt), ...songs, ...state.queue.slice(insertAt)],
            queuedCount: state.queuedCount + songs.length,
            originalQueue: state.originalQueue && [...state.originalQueue, ...songs],
          }
        }),

      removeFromQueue: (index) =>
        set((state) => {
          if (index === state.currentIndex || index < 0 || index >= state.queue.length) return {}
          const removed = state.queue[index]
          const inQueuedRange = index > state.currentIndex && index <= state.currentIndex + state.queuedCount
          return {
            queue: state.queue.filter((_, position) => position !== index),
            currentIndex: index < state.currentIndex ? state.currentIndex - 1 : state.currentIndex,
            queuedCount: inQueuedRange ? state.queuedCount - 1 : state.queuedCount,
            originalQueue: state.originalQueue && withoutFirst(state.originalQueue, removed),
          }
        }),

      toggleShuffle: () => set((state) => (state.shuffle ? shuffleOff(state) : shuffleOn(state))),

      cycleShuffle: () =>
        set((state) => {
          if (!state.shuffle) return { ...shuffleOn(state), smartShuffle: false }
          if (!state.smartShuffle) return { smartShuffle: true }
          return shuffleOff(state)
        }),

      appendSuggestions: (songs) =>
        set((state) => (songs.length === 0 ? {} : { queue: [...state.queue, ...songs], originalQueue: state.originalQueue && [...state.originalQueue, ...songs] })),

      // Songs go into the shuffled part after what the user queued, one after every `every` songs.
      insertSmartSuggestions: (songs, every) =>
        set((state) => {
          if (songs.length === 0) return {}
          const start = state.currentIndex + 1 + state.queuedCount
          const upcoming: SubsonicSong[] = []
          let next = 0
          state.queue.slice(start).forEach((song, index) => {
            upcoming.push(song)
            if ((index + 1) % every === 0 && next < songs.length) upcoming.push(songs[next++])
          })
          return { queue: [...state.queue.slice(0, start), ...upcoming, ...songs.slice(next)] }
        }),

      removeSmartSuggestions: () =>
        set((state) => {
          const keep = (song: SubsonicSong, index: number) => song.suggested !== 'smart' || index === state.currentIndex
          if (state.queue.every(keep)) return {}
          const removedBefore = state.queue.slice(0, state.currentIndex).filter((song, index) => !keep(song, index)).length
          const removedQueued = state.queue.slice(state.currentIndex + 1, state.currentIndex + 1 + state.queuedCount).filter((song) => song.suggested === 'smart').length
          return { queue: state.queue.filter(keep), currentIndex: state.currentIndex - removedBefore, queuedCount: state.queuedCount - removedQueued }
        }),

      cycleRepeat: () => set((state) => ({ repeat: nextRepeatMode[state.repeat] })),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setQueueOpen: (queueOpen) => set((state) => ({ queueOpen, lyricsOpen: queueOpen ? false : state.lyricsOpen })),
      setLyricsOpen: (lyricsOpen) => set((state) => ({ lyricsOpen, queueOpen: lyricsOpen ? false : state.queueOpen })),
      setFullScreenOpen: (fullScreenOpen) => set({ fullScreenOpen }),
      clear: () =>
        set((state) => ({ queue: [], originalQueue: null, currentIndex: 0, queuedCount: 0, history: [], source: null, isPlaying: false, playbackId: state.playbackId + 1, queueOpen: false, lyricsOpen: false, fullScreenOpen: false })),
    }),
    {
      name: 'spotydrome-player',
      version: 1,
      partialize: (state) => ({
        queue: state.queue,
        originalQueue: state.originalQueue,
        currentIndex: state.currentIndex,
        queuedCount: state.queuedCount,
        history: state.history,
        source: state.source,
        shuffle: state.shuffle,
        smartShuffle: state.smartShuffle,
        repeat: state.repeat,
        volume: state.volume,
        muted: state.muted,
      }),
    },
  ),
)

export function shuffleLabel(shuffle: boolean, smart: boolean, canSmartShuffle: boolean): string {
  if (!shuffle) return 'Enable shuffle'
  if (!smart && canSmartShuffle) return 'Enable smart shuffle'
  return 'Disable shuffle'
}

export function useCurrentSong(): SubsonicSong | undefined {
  return usePlayerStore((state) => state.queue[state.currentIndex])
}

export function isSameSource(source: PlaySource | null, other: Pick<PlaySource, 'type' | 'id'>): boolean {
  return source !== null && source.type === other.type && source.id === other.id
}
