import { buildSubsonicUrl, subsonicPost, subsonicRequest, type SubsonicCredentials } from './client'
import type { AlbumListType, AlbumWithSongs, ArtistInfo, ArtistWithAlbums, PlaylistWithSongs, SearchResults, StarredItems, SubsonicAlbum, SubsonicPlaylist, SubsonicSong } from './types'

export type StarKind = 'song' | 'album' | 'artist'

const starParam: Record<StarKind, string> = { song: 'id', album: 'albumId', artist: 'artistId' }

export interface StreamOptions {
  format: string
  maxBitRate: number
  timeOffset?: number
}

export interface PlaylistChanges {
  name?: string
  comment?: string
  public?: boolean
  songIdsToAdd?: string[]
  songIndexesToRemove?: number[]
}

export async function ping(credentials: SubsonicCredentials, signal?: AbortSignal): Promise<void> {
  await subsonicRequest('ping', credentials, {}, signal)
}

export async function getAlbumList(credentials: SubsonicCredentials, type: AlbumListType, size: number, signal?: AbortSignal): Promise<SubsonicAlbum[]> {
  const response = await subsonicRequest<{ albumList2?: { album?: SubsonicAlbum[] } }>('getAlbumList2', credentials, { type, size }, signal)
  return response.albumList2?.album ?? []
}

export async function getAlbum(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<AlbumWithSongs> {
  const response = await subsonicRequest<{ album: AlbumWithSongs }>('getAlbum', credentials, { id }, signal)
  return response.album
}

export async function getSong(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<SubsonicSong> {
  const response = await subsonicRequest<{ song: SubsonicSong }>('getSong', credentials, { id }, signal)
  return response.song
}

export async function getArtist(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<ArtistWithAlbums> {
  const response = await subsonicRequest<{ artist: ArtistWithAlbums }>('getArtist', credentials, { id }, signal)
  return response.artist
}

export async function getArtistInfo(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<ArtistInfo> {
  const response = await subsonicRequest<{ artistInfo2?: ArtistInfo }>('getArtistInfo2', credentials, { id, count: 12 }, signal)
  return response.artistInfo2 ?? {}
}

export async function getTopSongs(credentials: SubsonicCredentials, artistName: string, signal?: AbortSignal): Promise<SubsonicSong[]> {
  const response = await subsonicRequest<{ topSongs?: { song?: SubsonicSong[] } }>('getTopSongs', credentials, { artist: artistName, count: 10 }, signal)
  return response.topSongs?.song ?? []
}

// Navidrome's Instant Mix: songs from the library that Last.fm or Deezer consider similar. Empty without those agents.
export async function getSimilarSongs(credentials: SubsonicCredentials, id: string, count: number, signal?: AbortSignal): Promise<SubsonicSong[]> {
  const response = await subsonicRequest<{ similarSongs2?: { song?: SubsonicSong[] } }>('getSimilarSongs2', credentials, { id, count }, signal)
  return response.similarSongs2?.song ?? []
}

export async function search(credentials: SubsonicCredentials, query: string, signal?: AbortSignal): Promise<SearchResults> {
  const response = await subsonicRequest<{ searchResult3?: { artist?: SearchResults['artists']; album?: SearchResults['albums']; song?: SearchResults['songs'] } }>('search3', credentials, { query, artistCount: 10, albumCount: 12, songCount: 30 }, signal)
  const result = response.searchResult3
  return { artists: result?.artist ?? [], albums: result?.album ?? [], songs: result?.song ?? [] }
}

export async function getStarred(credentials: SubsonicCredentials, signal?: AbortSignal): Promise<StarredItems> {
  const response = await subsonicRequest<{ starred2?: StarredItems }>('getStarred2', credentials, {}, signal)
  return response.starred2 ?? {}
}

export async function setStarred(credentials: SubsonicCredentials, kind: StarKind, id: string, starred: boolean): Promise<void> {
  await subsonicPost(starred ? 'star' : 'unstar', credentials, { [starParam[kind]]: id })
}

export async function getPlaylists(credentials: SubsonicCredentials, signal?: AbortSignal): Promise<SubsonicPlaylist[]> {
  const response = await subsonicRequest<{ playlists?: { playlist?: SubsonicPlaylist[] } }>('getPlaylists', credentials, {}, signal)
  return response.playlists?.playlist ?? []
}

export async function getPlaylist(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<PlaylistWithSongs> {
  const response = await subsonicRequest<{ playlist: PlaylistWithSongs }>('getPlaylist', credentials, { id }, signal)
  return response.playlist
}

export async function createPlaylist(credentials: SubsonicCredentials, name: string, songIds: string[] = []): Promise<PlaylistWithSongs> {
  const response = await subsonicPost<{ playlist: PlaylistWithSongs }>('createPlaylist', credentials, { name, songId: songIds })
  return response.playlist
}

// createPlaylist with a playlistId replaces the whole track list, which is how reordering is persisted.
export async function replacePlaylistSongs(credentials: SubsonicCredentials, playlistId: string, songIds: string[]): Promise<void> {
  await subsonicPost('createPlaylist', credentials, { playlistId, songId: songIds })
}

export async function updatePlaylist(credentials: SubsonicCredentials, playlistId: string, changes: PlaylistChanges): Promise<void> {
  await subsonicPost('updatePlaylist', credentials, {
    playlistId,
    name: changes.name,
    comment: changes.comment,
    public: changes.public,
    songIdToAdd: changes.songIdsToAdd,
    songIndexToRemove: changes.songIndexesToRemove,
  })
}

export async function deletePlaylist(credentials: SubsonicCredentials, id: string): Promise<void> {
  await subsonicPost('deletePlaylist', credentials, { id })
}

export async function scrobble(credentials: SubsonicCredentials, id: string, submission: boolean): Promise<void> {
  await subsonicPost('scrobble', credentials, { id, submission, time: Date.now() })
}

export function getStreamUrl(credentials: SubsonicCredentials, songId: string, options: StreamOptions): string {
  return buildSubsonicUrl('stream', credentials, { id: songId, format: options.format, maxBitRate: options.maxBitRate || undefined, timeOffset: options.timeOffset || undefined }).toString()
}

export function getCoverArtUrl(credentials: SubsonicCredentials, coverArtId: string, size: number): string {
  return buildSubsonicUrl('getCoverArt', credentials, { id: coverArtId, size }).toString()
}

export interface StructuredLyrics {
  synced: boolean
  line: { start?: number; value: string }[]
}

// OpenSubsonic: lyrics embedded in the file or in a .lrc beside it. Servers without the extension answer with an error.
export async function getLyricsBySongId(credentials: SubsonicCredentials, id: string, signal?: AbortSignal): Promise<StructuredLyrics[]> {
  const response = await subsonicRequest<{ lyricsList?: { structuredLyrics?: StructuredLyrics[] } }>('getLyricsBySongId', credentials, { id }, signal)
  return response.lyricsList?.structuredLyrics ?? []
}
