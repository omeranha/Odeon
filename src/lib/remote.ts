import type { SubsonicCredentials } from './subsonic/client'
import type { SubsonicSong } from './subsonic/types'

export interface RemoteSong {
  id: string
  title: string
  artist?: string
  album?: string
  albumId?: string
  coverArt?: string
  duration?: number
  // Lets the receiving device tell whether Navidrome converts the file or sends it as-is, which decides how it seeks.
  suffix?: string
  bitRate?: number
  external?: { catalogId: string; coverUrl?: string; video?: string; title?: string; artist?: string; explicit?: boolean }
}

export interface RemoteState {
  song: RemoteSong | null
  playing: boolean
  positionMs: number
  durationMs: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  upcoming: RemoteSong[]
  ageMs: number
}

export interface RemoteDevice {
  id: string
  name: string
  kind: 'browser' | 'car' | 'other'
  online: boolean
  active: boolean
  state: RemoteState | null
}

export interface ReportedState {
  song: RemoteSong | null
  playing: boolean
  positionMs: number
  durationMs: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  upcoming: RemoteSong[]
}

export type RemoteCommand =
  | { type: 'toggle' | 'play' | 'pause' | 'next' | 'previous' | 'shuffle' | 'repeat' }
  | { type: 'seek'; positionMs: number }
  | { type: 'jump'; index: number }
  | { type: 'playQueue' | 'transfer'; songs: RemoteSong[]; startIndex: number; positionMs?: number; playing?: boolean }

function headers(credentials: SubsonicCredentials) {
  return { 'Content-Type': 'application/json', 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt }
}

async function call<T>(credentials: SubsonicCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/remote${path}`, { ...init, headers: headers(credentials) })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`)
  }
  return response.status === 204 || response.status === 202 ? (undefined as T) : ((await response.json()) as T)
}

export const remoteApi = {
  devices: (credentials: SubsonicCredentials) => call<RemoteDevice[]>(credentials, '/devices'),
  send: (credentials: SubsonicCredentials, deviceId: string, command: RemoteCommand) => call<void>(credentials, `/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: JSON.stringify(command) }),
  report: (credentials: SubsonicCredentials, deviceId: string, name: string, state: ReportedState) => call<{ active: boolean }>(credentials, `/devices/${encodeURIComponent(deviceId)}`, { method: 'PUT', body: JSON.stringify({ name, kind: 'browser', state }), keepalive: true }),
  poll: (credentials: SubsonicCredentials, deviceId: string, signal: AbortSignal) => call<{ commands: RemoteCommand[] }>(credentials, `/devices/${encodeURIComponent(deviceId)}/commands`, { signal }),
  leave: (credentials: SubsonicCredentials, deviceId: string) => call<void>(credentials, `/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE', keepalive: true }),
}

// The local stream URL carries this browser's credentials, so only what the other device needs to find the song is sent.
export function toRemoteSong(song: SubsonicSong): RemoteSong {
  let external: RemoteSong['external']
  if (song.external) {
    const params = new URLSearchParams(song.external.streamUrl.split('?')[1] ?? '')
    external = { catalogId: song.external.catalogId, coverUrl: song.external.coverUrl, video: params.get('video') ?? undefined, title: params.get('title') ?? undefined, artist: params.get('artist') ?? undefined, explicit: params.get('explicit') === '1' || undefined }
  }
  return { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, coverArt: song.coverArt, duration: song.duration, suffix: song.suffix, bitRate: song.bitRate, external }
}

// Rebuilds a playable song here, with this browser's own credentials for songs streamed through Downtify.
export function fromRemoteSong(song: RemoteSong, credentials: SubsonicCredentials): SubsonicSong {
  if (!song.external) return { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, coverArt: song.coverArt, duration: song.duration, suffix: song.suffix, bitRate: song.bitRate }
  const params = new URLSearchParams({ u: credentials.username, t: credentials.token, s: credentials.salt })
  if (song.external.video) params.set('video', song.external.video)
  else {
    params.set('title', song.external.title ?? song.title)
    const artist = song.external.artist ?? song.artist?.split(', ')[0]
    if (artist) params.set('artist', artist)
    if (song.external.explicit) params.set('explicit', '1')
  }
  if (song.duration) params.set('duration', String(song.duration))
  return { id: song.id, title: song.title, artist: song.artist, album: song.album, duration: song.duration, external: { streamUrl: `/api/downtify/stream?${params}`, coverUrl: song.external.coverUrl, catalogId: song.external.catalogId, explicit: song.external.explicit } }
}

export function coverSongOf(song: RemoteSong): SubsonicSong {
  return { id: song.id, title: song.title, artist: song.artist, album: song.album, coverArt: song.coverArt, duration: song.duration, external: song.external ? { streamUrl: '', coverUrl: song.external.coverUrl, catalogId: song.external.catalogId } : undefined }
}
