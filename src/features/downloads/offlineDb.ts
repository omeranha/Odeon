import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AlbumWithSongs, PlaylistWithSongs, SubsonicSong } from '../../lib/subsonic/types'

export type CollectionType = 'album' | 'playlist' | 'liked'

export interface OfflineSong {
  id: string
  song: SubsonicSong
  bytes: number
  downloadedAt: number
  standalone: boolean
}

export interface OfflineCollection {
  key: string
  type: CollectionType
  id: string
  name: string
  coverArt?: string
  songIds: string[]
  snapshot: AlbumWithSongs | PlaylistWithSongs | { song: SubsonicSong[] }
  savedAt: number
}

interface OfflineSchema extends DBSchema {
  songs: { key: string; value: OfflineSong }
  collections: { key: string; value: OfflineCollection }
}

let database: Promise<IDBPDatabase<OfflineSchema>> | null = null

function db(): Promise<IDBPDatabase<OfflineSchema>> {
  database ??= openDB<OfflineSchema>('spotydrome-offline', 1, {
    upgrade(upgradeDb) {
      upgradeDb.createObjectStore('songs', { keyPath: 'id' })
      upgradeDb.createObjectStore('collections', { keyPath: 'key' })
    },
  })
  return database
}

export function collectionKey(type: CollectionType, id: string): string {
  return `${type}:${id}`
}

export const offlineDb = {
  async allSongs(): Promise<OfflineSong[]> {
    return (await db()).getAll('songs')
  },
  async getSong(id: string): Promise<OfflineSong | undefined> {
    return (await db()).get('songs', id)
  },
  async putSong(song: OfflineSong): Promise<void> {
    await (await db()).put('songs', song)
  },
  async deleteSong(id: string): Promise<void> {
    await (await db()).delete('songs', id)
  },
  async allCollections(): Promise<OfflineCollection[]> {
    return (await db()).getAll('collections')
  },
  async getCollection(type: CollectionType, id: string): Promise<OfflineCollection | undefined> {
    return (await db()).get('collections', collectionKey(type, id))
  },
  async putCollection(collection: OfflineCollection): Promise<void> {
    await (await db()).put('collections', collection)
  },
  async deleteCollection(key: string): Promise<void> {
    await (await db()).delete('collections', key)
  },
  async clear(): Promise<void> {
    const handle = await db()
    await Promise.all([handle.clear('songs'), handle.clear('collections')])
  },
}
