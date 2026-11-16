import type { RemoteSong } from './remote'
import type { SubsonicCredentials } from './subsonic/client'

export interface PlayEntry {
  song: RemoteSong
  at: number
}

export interface SearchEntry {
  query: string
  at: number
}

export interface MonthlyUsage {
  month: string
  seconds: number
}

export interface LikedSongEntry {
  song: RemoteSong
  at: number
}

function headers(credentials: SubsonicCredentials) {
  return { 'Content-Type': 'application/json', 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt }
}

async function call<T>(credentials: SubsonicCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: headers(credentials) })
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`)
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

const json = (value: unknown, keepalive = false): RequestInit => ({ method: 'POST', body: JSON.stringify(value), keepalive })

export const activityApi = {
  plays: (credentials: SubsonicCredentials, limit: number) => call<PlayEntry[]>(credentials, `/api/activity/plays?limit=${limit}`),
  addPlay: (credentials: SubsonicCredentials, song: RemoteSong) => call<void>(credentials, '/api/activity/plays', json({ song })),
  clearPlays: (credentials: SubsonicCredentials) => call<void>(credentials, '/api/activity/plays', { method: 'DELETE' }),
  searches: (credentials: SubsonicCredentials) => call<SearchEntry[]>(credentials, '/api/activity/searches'),
  addSearch: (credentials: SubsonicCredentials, query: string) => call<void>(credentials, '/api/activity/searches', json({ query })),
  removeSearch: (credentials: SubsonicCredentials, query: string) => call<void>(credentials, `/api/activity/searches?query=${encodeURIComponent(query)}`, { method: 'DELETE' }),
  clearSearches: (credentials: SubsonicCredentials) => call<void>(credentials, '/api/activity/searches', { method: 'DELETE' }),
  usage: (credentials: SubsonicCredentials) => call<{ months: MonthlyUsage[] }>(credentials, '/api/activity/usage'),
  addUsage: (credentials: SubsonicCredentials, seconds: number, keepalive = false) => call<void>(credentials, '/api/activity/usage', json({ seconds }, keepalive)),
}

export const likedSongsApi = {
  list: (credentials: SubsonicCredentials) => call<LikedSongEntry[]>(credentials, '/api/liked-songs'),
  add: (credentials: SubsonicCredentials, song: RemoteSong) => call<void>(credentials, '/api/liked-songs', json({ song })),
  remove: (credentials: SubsonicCredentials, songId: string) => call<void>(credentials, `/api/liked-songs/${encodeURIComponent(songId)}`, { method: 'DELETE' }),
}
