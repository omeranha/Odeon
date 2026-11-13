import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { saveCollection, useDownloadStore, type CollectionSummary, type DownloadContext, type SongDownload } from './downloadManager'
import { collectionKey, type CollectionType, type OfflineCollection } from './offlineDb'

export function useDownloadContext(): DownloadContext {
  const profile = useCurrentProfile()
  return { credentials: credentialsOf(profile) }
}

export function useSongDownload(songId: string): SongDownload | undefined {
  return useDownloadStore((state) => state.songs[songId])
}

export interface CollectionDownloadStatus {
  saved: boolean
  state: 'none' | 'downloading' | 'done'
  progress: number
}

export function useCollectionDownload(type: CollectionType, id: string): CollectionDownloadStatus {
  const collection = useDownloadStore((state) => state.collections[collectionKey(type, id)])
  const done = useDownloadStore((state) => (collection ? collection.songIds.filter((songId) => state.songs[songId]?.state === 'done').length : 0))
  if (!collection) return { saved: false, state: 'none', progress: 0 }
  const total = collection.songIds.length
  return { saved: true, state: done >= total ? 'done' : 'downloading', progress: total > 0 ? done / total : 1 }
}

function subscribeToOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToOnline, () => navigator.onLine)
}

export interface CollectionDownloadInput {
  type: CollectionType
  id: string
  name: string
  coverArt?: string
  songs: SubsonicSong[]
  snapshot: OfflineCollection['snapshot']
}

// Keeps a downloaded playlist (or Liked Songs) matching the server: new songs get downloaded, removed ones get deleted.
export function useKeepDownloadInSync(input: CollectionDownloadInput) {
  const context = useDownloadContext()
  const key = collectionKey(input.type, input.id)
  const stored = useDownloadStore((state) => {
    const collection = state.collections[key]
    return collection ? `${collection.name}|${collection.songIds.join(',')}` : null
  })
  const current = `${input.name}|${input.songs.map((song) => song.id).join(',')}`
  const latest = useRef({ input, context })

  useEffect(() => {
    latest.current = { input, context }
  })

  useEffect(() => {
    if (stored === null || stored === current || !navigator.onLine) return
    void saveCollection(latest.current.input, latest.current.context)
  }, [stored, current])
}

export function collectionPath(collection: Pick<CollectionSummary, 'type' | 'id'>): string {
  if (collection.type === 'liked') return '/collection/tracks'
  return `/${collection.type}/${collection.id}`
}

export function useDownloadedCollections(): CollectionSummary[] {
  const collections = useDownloadStore((state) => state.collections)
  return useMemo(() => Object.values(collections).sort((a, b) => b.savedAt - a.savedAt), [collections])
}
