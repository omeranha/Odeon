import { config } from './config.ts'

export interface SubsonicAuth {
  username: string
  token: string
  salt: string
}

export interface NavidromeSong {
  id: string
  title: string
  artist?: string
  displayArtist?: string
  albumArtist?: string
  artists?: { name: string }[]
  album?: string
  albumId?: string
  artistId?: string
  coverArt?: string
  duration?: number
  suffix?: string
  bitRate?: number
  year?: number
  genre?: string
}

export interface NavidromeArtist {
  id: string
  name: string
}

export interface NavidromeAlbum {
  id: string
  name: string
  artist?: string
  artistId?: string
  coverArt?: string
}

export interface NavidromePlaylist {
  id: string
  name: string
  owner?: string
  comment?: string
  entry?: NavidromeSong[]
}

type Params = Record<string, string | string[] | undefined>

async function call<T extends object>(auth: SubsonicAuth, endpoint: string, params: Params = {}): Promise<T> {
  const body = new URLSearchParams({ u: auth.username, t: auth.token, s: auth.salt, v: '1.16.1', c: 'odeon-server', f: 'json' })
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) body.append(key, item)
  }
  const response = await fetch(`${config.navidromeUrl}/rest/${endpoint}`, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Navidrome ${endpoint} failed with HTTP ${response.status}`)
  const payload = ((await response.json()) as { 'subsonic-response': { status: string; error?: { message?: string } } & T })['subsonic-response']
  if (payload.status !== 'ok') throw new Error(payload.error?.message ?? `Navidrome ${endpoint} failed`)
  return payload
}

export const navidrome = {
  async searchSongs(auth: SubsonicAuth, query: string): Promise<NavidromeSong[]> {
    const result = await call<{ searchResult3?: { song?: NavidromeSong[] } }>(auth, 'search3', { query, songCount: '30', artistCount: '0', albumCount: '0' })
    return result.searchResult3?.song ?? []
  },

  async createPlaylist(auth: SubsonicAuth, name: string): Promise<string> {
    const result = await call<{ playlist: { id: string } }>(auth, 'createPlaylist', { name })
    return result.playlist.id
  },

  async getPlaylist(auth: SubsonicAuth, id: string): Promise<NavidromePlaylist> {
    const result = await call<{ playlist: NavidromePlaylist }>(auth, 'getPlaylist', { id })
    return result.playlist
  },

  async getUser(auth: SubsonicAuth): Promise<{ username: string; adminRole: boolean; email?: string }> {
    const result = await call<{ user: { username: string; adminRole?: boolean; email?: string } }>(auth, 'getUser', { username: auth.username })
    return { username: result.user.username, adminRole: Boolean(result.user.adminRole), email: result.user.email }
  },

  async setComment(auth: SubsonicAuth, playlistId: string, comment: string): Promise<void> {
    await call(auth, 'updatePlaylist', { playlistId, comment })
  },

  // createPlaylist with a playlistId replaces the whole track list, which keeps the source order however songs arrive.
  async setSongs(auth: SubsonicAuth, playlistId: string, songIds: string[]): Promise<void> {
    await call(auth, 'createPlaylist', { playlistId, songId: songIds })
  },

  // Admin only. A full scan re-reads every file, including ones rewritten without a newer modification time.
  async startFullScan(auth: SubsonicAuth): Promise<void> {
    await call(auth, 'startScan', { fullScan: 'true' })
  },

  async search(auth: SubsonicAuth, query: string): Promise<{ artists: NavidromeArtist[]; albums: NavidromeAlbum[]; songs: NavidromeSong[] }> {
    const result = await call<{ searchResult3?: { artist?: NavidromeArtist[]; album?: NavidromeAlbum[]; song?: NavidromeSong[] } }>(auth, 'search3', { query, artistCount: '5', albumCount: '5', songCount: '30' })
    return { artists: result.searchResult3?.artist ?? [], albums: result.searchResult3?.album ?? [], songs: result.searchResult3?.song ?? [] }
  },

  async artistAlbums(auth: SubsonicAuth, id: string): Promise<NavidromeAlbum[]> {
    const result = await call<{ artist?: { album?: NavidromeAlbum[] } }>(auth, 'getArtist', { id })
    return result.artist?.album ?? []
  },

  async albumSongs(auth: SubsonicAuth, id: string): Promise<NavidromeSong[]> {
    const result = await call<{ album?: { song?: NavidromeSong[] } }>(auth, 'getAlbum', { id })
    return result.album?.song ?? []
  },

  // Ranked by Last.fm listeners, so it's empty without Navidrome's Last.fm agent.
  async topSongs(auth: SubsonicAuth, artist: string, count: number): Promise<NavidromeSong[]> {
    const result = await call<{ topSongs?: { song?: NavidromeSong[] } }>(auth, 'getTopSongs', { artist, count: String(count) })
    return result.topSongs?.song ?? []
  },

  async playlists(auth: SubsonicAuth): Promise<NavidromePlaylist[]> {
    const result = await call<{ playlists?: { playlist?: NavidromePlaylist[] } }>(auth, 'getPlaylists')
    return result.playlists?.playlist ?? []
  },

  async starredSongs(auth: SubsonicAuth): Promise<NavidromeSong[]> {
    const result = await call<{ starred2?: { song?: NavidromeSong[] } }>(auth, 'getStarred2')
    return result.starred2?.song ?? []
  },

  // Navidrome's Instant Mix, from its Last.fm or Deezer agent. Empty without one.
  async similarSongs(auth: SubsonicAuth, id: string, count: number): Promise<NavidromeSong[]> {
    const result = await call<{ similarSongs2?: { song?: NavidromeSong[] } }>(auth, 'getSimilarSongs2', { id, count: String(count) })
    return result.similarSongs2?.song ?? []
  },

  async scrobble(auth: SubsonicAuth, id: string, submission: boolean): Promise<void> {
    await call(auth, 'scrobble', { id, submission: String(submission), time: String(Date.now()) })
  },
}
