import { SubsonicError } from '../../lib/subsonic/client'
import type { AlbumWithSongs, PlaylistWithSongs, SearchResults, StarredItems, SubsonicPlaylist, SubsonicSong } from '../../lib/subsonic/types'
import { offlineDb } from './offlineDb'

// Server-side errors (not found, no permission) are real answers; only network failures fall back to downloads.
export async function withOfflineFallback<T>(request: () => Promise<T>, fallback: () => Promise<T | undefined>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    if (error instanceof SubsonicError || (error instanceof DOMException && error.name === 'AbortError')) throw error
    const offline = await fallback().catch(() => undefined)
    if (offline !== undefined) return offline
    throw error
  }
}

export async function offlineAlbum(id: string): Promise<AlbumWithSongs | undefined> {
  return (await offlineDb.getCollection('album', id))?.snapshot as AlbumWithSongs | undefined
}

export async function offlinePlaylist(id: string): Promise<PlaylistWithSongs | undefined> {
  return (await offlineDb.getCollection('playlist', id))?.snapshot as PlaylistWithSongs | undefined
}

export async function offlinePlaylists(): Promise<SubsonicPlaylist[]> {
  const collections = await offlineDb.allCollections()
  return collections.filter((collection) => collection.type === 'playlist').map((collection) => collection.snapshot as PlaylistWithSongs)
}

export async function offlineStarred(): Promise<StarredItems | undefined> {
  const liked = await offlineDb.getCollection('liked', 'songs')
  return liked ? { song: (liked.snapshot as { song: SubsonicSong[] }).song } : undefined
}

export async function offlineSearch(query: string): Promise<SearchResults> {
  const term = query.toLowerCase()
  const songs = (await offlineDb.allSongs()).map((entry) => entry.song).filter((song) => [song.title, song.artist, song.album].some((value) => value?.toLowerCase().includes(term)))
  return { artists: [], albums: [], songs }
}
