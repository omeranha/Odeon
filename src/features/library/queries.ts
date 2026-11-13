import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { coverSizeBucket } from '../../lib/offlineCaches'
import * as api from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { AlbumListType } from '../../lib/subsonic/types'
import { offlineAlbum, offlinePlaylist, offlinePlaylists, offlineSearch, offlineStarred, withOfflineFallback } from '../downloads/offlineFallback'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'

export const queryKeys = {
  albumList: (type: AlbumListType, size: number) => ['albumList', type, size] as const,
  album: (id: string) => ['album', id] as const,
  artist: (id: string) => ['artist', id] as const,
  artistInfo: (id: string) => ['artistInfo', id] as const,
  topSongs: (artistName: string) => ['topSongs', artistName] as const,
  search: (query: string) => ['search', query] as const,
  starred: ['starred'] as const,
  playlists: ['playlists'] as const,
  playlist: (id: string) => ['playlist', id] as const,
}

export function useCredentials(): SubsonicCredentials {
  return credentialsOf(useCurrentProfile())
}

export function useAlbumList(type: AlbumListType, size: number) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.albumList(type, size), queryFn: ({ signal }) => api.getAlbumList(credentials, type, size, signal) })
}

export function useAlbum(id: string) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.album(id), queryFn: ({ signal }) => withOfflineFallback(() => api.getAlbum(credentials, id, signal), () => offlineAlbum(id)) })
}

export function useArtist(id: string | undefined) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.artist(id ?? ''), queryFn: ({ signal }) => api.getArtist(credentials, id ?? '', signal), enabled: Boolean(id) })
}

export function useArtistInfo(id: string) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.artistInfo(id), queryFn: ({ signal }) => api.getArtistInfo(credentials, id, signal), staleTime: 60 * 60 * 1000 })
}

export function useTopSongs(artistName: string) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.topSongs(artistName), queryFn: ({ signal }) => api.getTopSongs(credentials, artistName, signal), staleTime: 60 * 60 * 1000 })
}

export function useSearch(query: string) {
  const credentials = useCredentials()
  const trimmed = query.trim()
  return useQuery({ queryKey: queryKeys.search(trimmed), queryFn: ({ signal }) => withOfflineFallback(() => api.search(credentials, trimmed, signal), () => offlineSearch(trimmed)), enabled: trimmed.length > 0, placeholderData: keepPreviousData })
}

export function useStarred() {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.starred, queryFn: ({ signal }) => withOfflineFallback(() => api.getStarred(credentials, signal), offlineStarred) })
}

export function usePlaylists() {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.playlists, queryFn: ({ signal }) => withOfflineFallback(() => api.getPlaylists(credentials, signal), offlinePlaylists) })
}

export function usePlaylist(id: string) {
  const credentials = useCredentials()
  return useQuery({ queryKey: queryKeys.playlist(id), queryFn: ({ signal }) => withOfflineFallback(() => api.getPlaylist(credentials, id, signal), () => offlinePlaylist(id)) })
}

export function useLibraryFetchers() {
  const queryClient = useQueryClient()
  const credentials = useCredentials()
  return {
    album: (id: string) => queryClient.fetchQuery({ queryKey: queryKeys.album(id), queryFn: ({ signal }) => withOfflineFallback(() => api.getAlbum(credentials, id, signal), () => offlineAlbum(id)) }),
    playlist: (id: string) => queryClient.fetchQuery({ queryKey: queryKeys.playlist(id), queryFn: ({ signal }) => withOfflineFallback(() => api.getPlaylist(credentials, id, signal), () => offlinePlaylist(id)) }),
  }
}

export function useCoverArtUrl(coverArtId: string | undefined, size: number): string | undefined {
  const credentials = useCredentials()
  return coverArtId ? api.getCoverArtUrl(credentials, coverArtId, coverSizeBucket(size)) : undefined
}
