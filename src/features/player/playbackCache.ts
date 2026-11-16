import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { audioCacheKey, PLAYBACK_CACHE } from '../../lib/offlineCaches'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useDownloadStore } from '../downloads/downloadManager'

export interface CachedSong {
  id: string
  bytes: number
  lastPlayedAt: number
}

interface PlaybackCacheState {
  hydrated: boolean
  songs: Record<string, CachedSong>
  limitMb: number
  setLimitMb: (limitMb: number) => void
}

export const PLAYBACK_CACHE_LIMITS_MB = [0, 256, 512, 1024, 2048, 5120]
const DEFAULT_LIMIT_MB = 1024
const MAX_SONG_BYTES = 150 * 1024 * 1024

interface CacheSchema extends DBSchema {
  songs: { key: string; value: CachedSong }
}

let database: Promise<IDBPDatabase<CacheSchema>> | null = null

function db(): Promise<IDBPDatabase<CacheSchema>> {
  database ??= openDB<CacheSchema>('odeon-playback', 1, {
    upgrade(upgradeDb) {
      upgradeDb.createObjectStore('songs', { keyPath: 'id' })
    },
  })
  return database
}

// Songs played for a while are kept on the device, the least recently played going first once the limit is reached.
export const usePlaybackCacheStore = create<PlaybackCacheState>()(
  persist(
    (set) => ({
      hydrated: false,
      songs: {},
      limitMb: DEFAULT_LIMIT_MB,
      setLimitMb: (limitMb) => {
        set({ limitMb })
        void enforceLimit()
      },
    }),
    { name: 'odeon-playback-cache', version: 1, partialize: (state) => ({ limitMb: state.limitMb }) },
  ),
)

function setSongs(change: (songs: Record<string, CachedSong>) => void) {
  usePlaybackCacheStore.setState((state) => {
    const songs = { ...state.songs }
    change(songs)
    return { songs }
  })
}

export async function hydratePlaybackCache(): Promise<void> {
  const stored = await (await db()).getAll('songs').catch(() => [] as CachedSong[])
  usePlaybackCacheStore.setState({ hydrated: true, songs: Object.fromEntries(stored.map((song) => [song.id, song])) })
}

export function hasCachedSong(songId: string): boolean {
  return songId in usePlaybackCacheStore.getState().songs
}

async function forget(songIds: string[]) {
  if (songIds.length === 0) return
  const [cache, handle] = await Promise.all([caches.open(PLAYBACK_CACHE), db()])
  await Promise.all(songIds.flatMap((id) => [cache.delete(audioCacheKey(id)), handle.delete('songs', id)]))
  setSongs((songs) => songIds.forEach((id) => delete songs[id]))
}

async function enforceLimit() {
  const { songs, limitMb } = usePlaybackCacheStore.getState()
  const limit = limitMb * 1024 * 1024
  let total = Object.values(songs).reduce((sum, song) => sum + song.bytes, 0)
  const oldestFirst = Object.values(songs).sort((a, b) => a.lastPlayedAt - b.lastPlayedAt)
  const evicted: string[] = []
  for (const song of oldestFirst) {
    if (total <= limit) break
    total -= song.bytes
    evicted.push(song.id)
  }
  await forget(evicted)
}

export async function clearPlaybackCache() {
  await Promise.all([caches.delete(PLAYBACK_CACHE), db().then((handle) => handle.clear('songs'))])
  usePlaybackCacheStore.setState({ songs: {} })
}

// Returns undefined, and forgets the song, when the browser has already dropped the file.
export async function getCachedAudioUrl(songId: string): Promise<string | undefined> {
  const response = await (await caches.open(PLAYBACK_CACHE)).match(audioCacheKey(songId))
  if (!response) {
    await forget([songId])
    return undefined
  }
  const entry = usePlaybackCacheStore.getState().songs[songId]
  if (entry) {
    const touched = { ...entry, lastPlayedAt: Date.now() }
    setSongs((songs) => (songs[songId] = touched))
    void db().then((handle) => handle.put('songs', touched))
  }
  return URL.createObjectURL(await response.blob())
}

const inFlight = new Set<string>()

// Fetches the file the player is already streaming, so it should only be called once the song was really listened to.
export async function cachePlayedSong(song: SubsonicSong, sourceUrl: string) {
  const { limitMb, songs } = usePlaybackCacheStore.getState()
  const source = new URL(sourceUrl, window.location.origin)
  const skip =
    limitMb === 0 ||
    !navigator.onLine ||
    !/^https?:$/.test(source.protocol) ||
    source.origin !== window.location.origin ||
    inFlight.has(song.id) ||
    song.id in songs ||
    useDownloadStore.getState().songs[song.id]?.state === 'done' ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  if (skip) return

  inFlight.add(song.id)
  try {
    const response = await fetch(source)
    const contentType = response.headers.get('Content-Type') ?? ''
    if (response.status !== 200 || !/^(audio|video)\//.test(contentType)) return
    if (Number(response.headers.get('Content-Length')) > MAX_SONG_BYTES) return
    const blob = await response.blob()
    if (blob.size === 0 || blob.size > MAX_SONG_BYTES || blob.size > limitMb * 1024 * 1024) return

    await (await caches.open(PLAYBACK_CACHE)).put(audioCacheKey(song.id), new Response(blob, { headers: { 'Content-Type': contentType } }))
    const entry: CachedSong = { id: song.id, bytes: blob.size, lastPlayedAt: Date.now() }
    await (await db()).put('songs', entry)
    setSongs((current) => (current[song.id] = entry))
    await enforceLimit()
  } catch {
    // Offline, out of space or the request was cut off: the song just streams next time.
  } finally {
    inFlight.delete(song.id)
  }
}
