import { create } from 'zustand'
import { showToast } from '../../components/toastStore'
import { AUDIO_CACHE, audioCacheKey, COVER_SIZES, PINNED_COVER_CACHE } from '../../lib/offlineCaches'
import { getCoverArtUrl, getStreamUrl } from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { collectionKey, offlineDb, type CollectionType, type OfflineCollection } from './offlineDb'

export type SongDownloadState = 'queued' | 'downloading' | 'done' | 'error'

export interface SongDownload {
  state: SongDownloadState
  progress: number
}

export type CollectionSummary = Omit<OfflineCollection, 'snapshot'>

interface DownloadState {
  hydrated: boolean
  songs: Record<string, SongDownload>
  standalone: Record<string, boolean>
  collections: Record<string, CollectionSummary>
}

export const useDownloadStore = create<DownloadState>()(() => ({ hydrated: false, songs: {}, standalone: {}, collections: {} }))

export interface DownloadContext {
  credentials: SubsonicCredentials
}

const MAX_CONCURRENT = 2
const queue: { song: SubsonicSong; context: DownloadContext }[] = []
let active = 0
let failureToastShown = false

function setSong(id: string, value: SongDownload | null) {
  useDownloadStore.setState((state) => {
    const songs = { ...state.songs }
    if (value) songs[id] = value
    else delete songs[id]
    return { songs }
  })
}

function summary({ snapshot: _snapshot, ...rest }: OfflineCollection): CollectionSummary {
  return rest
}

export async function hydrateDownloads(): Promise<void> {
  const [songs, collections] = await Promise.all([offlineDb.allSongs(), offlineDb.allCollections()])
  useDownloadStore.setState({
    hydrated: true,
    songs: Object.fromEntries(songs.map((song) => [song.id, { state: 'done' as const, progress: 1 }])),
    standalone: Object.fromEntries(songs.filter((song) => song.standalone).map((song) => [song.id, true])),
    collections: Object.fromEntries(collections.map((collection) => [collection.key, summary(collection)])),
  })
}

async function requestPersistentStorage() {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
}

function enqueue(songs: SubsonicSong[], context: DownloadContext) {
  const { songs: current } = useDownloadStore.getState()
  for (const song of songs) {
    const existing = current[song.id]
    if (existing && existing.state !== 'error') continue
    setSong(song.id, { state: 'queued', progress: 0 })
    queue.push({ song, context })
  }
  void requestPersistentStorage()
  pump()
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()
    if (!next) break
    if (useDownloadStore.getState().songs[next.song.id]?.state !== 'queued') continue
    active++
    void downloadSong(next.song, next.context).finally(() => {
      active--
      pump()
    })
  }
}

async function downloadSong(song: SubsonicSong, context: DownloadContext) {
  setSong(song.id, { state: 'downloading', progress: 0 })

  try {
    const response = await fetch(getStreamUrl(context.credentials, song.id, { format: 'raw', maxBitRate: 0 }))
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

    const contentType = response.headers.get('Content-Type') ?? 'audio/mpeg'
    const declaredLength = Number(response.headers.get('Content-Length')) || 0
    const estimatedLength = declaredLength || (song.size ?? 0)
    let received = 0
    let lastReported = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        const progress = estimatedLength > 0 ? Math.min(0.99, received / estimatedLength) : 0
        if (progress - lastReported >= 0.05) {
          lastReported = progress
          setSong(song.id, { state: 'downloading', progress })
        }
        controller.enqueue(chunk)
      },
    })

    const cache = await caches.open(AUDIO_CACHE)
    await cache.put(audioCacheKey(song.id), new Response(response.body.pipeThrough(counter), { headers: { 'Content-Type': contentType } }))

    // The download may have been removed while it was in flight.
    if (!useDownloadStore.getState().songs[song.id]) {
      await cache.delete(audioCacheKey(song.id))
      return
    }

    await pinCovers(song.coverArt, context.credentials)
    await offlineDb.putSong({ id: song.id, song, bytes: received, downloadedAt: Date.now(), standalone: Boolean(useDownloadStore.getState().standalone[song.id]) })
    setSong(song.id, { state: 'done', progress: 1 })
  } catch {
    if (useDownloadStore.getState().songs[song.id]) setSong(song.id, { state: 'error', progress: 0 })
    if (!failureToastShown) {
      failureToastShown = true
      showToast("Some songs couldn't be downloaded. Try again when you're online.")
      setTimeout(() => (failureToastShown = false), 10000)
    }
  }
}

async function pinCovers(coverArt: string | undefined, credentials: SubsonicCredentials) {
  if (!coverArt) return
  const cache = await caches.open(PINNED_COVER_CACHE)
  await Promise.all(
    COVER_SIZES.map(async (size) => {
      const url = getCoverArtUrl(credentials, coverArt, size)
      if (!(await cache.match(url))) await cache.add(url).catch(() => undefined)
    }),
  )
}

async function removeSongFiles(songIds: string[]) {
  if (songIds.length === 0) return
  const cache = await caches.open(AUDIO_CACHE)
  await Promise.all(songIds.map((id) => Promise.all([cache.delete(audioCacheKey(id)), offlineDb.deleteSong(id)])))
  useDownloadStore.setState((state) => {
    const songs = { ...state.songs }
    const standalone = { ...state.standalone }
    for (const id of songIds) {
      delete songs[id]
      delete standalone[id]
    }
    return { songs, standalone }
  })
}

function songsStillNeeded(): Set<string> {
  const { collections, standalone } = useDownloadStore.getState()
  const needed = new Set(Object.keys(standalone))
  for (const collection of Object.values(collections)) collection.songIds.forEach((id) => needed.add(id))
  return needed
}

async function removeOrphans(candidates: string[]) {
  const needed = songsStillNeeded()
  await removeSongFiles(candidates.filter((id) => !needed.has(id)))
}

export async function saveCollection(input: { type: CollectionType; id: string; name: string; coverArt?: string; songs: SubsonicSong[]; snapshot: OfflineCollection['snapshot'] }, context: DownloadContext) {
  const previous = useDownloadStore.getState().collections[collectionKey(input.type, input.id)]
  const collection: OfflineCollection = { key: collectionKey(input.type, input.id), type: input.type, id: input.id, name: input.name, coverArt: input.coverArt, songIds: input.songs.map((song) => song.id), snapshot: input.snapshot, savedAt: Date.now() }
  await offlineDb.putCollection(collection)
  await pinCovers(input.coverArt, context.credentials)
  useDownloadStore.setState((state) => ({ collections: { ...state.collections, [collection.key]: summary(collection) } }))
  enqueue(input.songs, context)
  if (previous) await removeOrphans(previous.songIds.filter((id) => !collection.songIds.includes(id)))
}

export async function removeCollection(key: string) {
  const collection = useDownloadStore.getState().collections[key]
  if (!collection) return
  await offlineDb.deleteCollection(key)
  useDownloadStore.setState((state) => {
    const collections = { ...state.collections }
    delete collections[key]
    return { collections }
  })
  await removeOrphans(collection.songIds)
}

export function downloadSongs(songs: SubsonicSong[], context: DownloadContext) {
  useDownloadStore.setState((state) => ({ standalone: { ...state.standalone, ...Object.fromEntries(songs.map((song) => [song.id, true])) } }))
  enqueue(songs, context)
}

export async function removeSongDownload(songId: string): Promise<boolean> {
  useDownloadStore.setState((state) => {
    const standalone = { ...state.standalone }
    delete standalone[songId]
    return { standalone }
  })
  if (songsStillNeeded().has(songId)) {
    const stored = await offlineDb.getSong(songId)
    if (stored) await offlineDb.putSong({ ...stored, standalone: false })
    return false
  }
  await removeSongFiles([songId])
  return true
}

export async function removeAllDownloads() {
  queue.length = 0
  await Promise.all([caches.delete(AUDIO_CACHE), caches.delete(PINNED_COVER_CACHE), offlineDb.clear()])
  useDownloadStore.setState({ songs: {}, standalone: {}, collections: {} })
}

export async function getOfflineAudioUrl(songId: string): Promise<string | undefined> {
  if (useDownloadStore.getState().songs[songId]?.state !== 'done') return undefined
  const response = await (await caches.open(AUDIO_CACHE)).match(audioCacheKey(songId))
  return response ? URL.createObjectURL(await response.blob()) : undefined
}
