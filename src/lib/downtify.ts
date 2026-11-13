import type { SubsonicCredentials } from './subsonic/client'
import type { SubsonicSong } from './subsonic/types'

export interface CatalogTrack {
  id: string
  youtubeId?: string
  title: string
  artists: string[]
  album?: string
  coverUrl?: string
  duration?: number
  year?: string
  explicit: boolean
  trackNumber?: number
}

export interface ResolvedLink {
  kind: string
  name: string
  subtitle?: string
  coverUrl?: string
  year?: string
  tracks: CatalogTrack[]
}

export interface DownloadJob extends CatalogTrack {
  status: 'queued' | 'downloading' | 'done' | 'error'
  progress: number
  message?: string
  position?: number
}

export class DowntifyApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DowntifyApiError'
    this.status = status
  }
}

async function call<T>(credentials: SubsonicCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/downtify${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new DowntifyApiError(response.status, body.error ?? `Request failed with HTTP ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export async function getDowntifyStatus(): Promise<boolean> {
  try {
    const response = await fetch('/api/downtify/status')
    if (!response.ok) return false
    return ((await response.json()) as { enabled?: boolean }).enabled === true
  } catch {
    return false
  }
}

export function isMusicLink(text: string): boolean {
  return /^https?:\/\/(open\.spotify\.com|(music|www|m)\.youtube\.com|youtube\.com|youtu\.be|(www\.)?deezer\.com|(www\.|m\.)?soundcloud\.com)\//i.test(text.trim())
}

export const downtifyApi = {
  search: (credentials: SubsonicCredentials, query: string, signal?: AbortSignal) => call<{ tracks: CatalogTrack[] }>(credentials, `/search?q=${encodeURIComponent(query)}`, { signal }).then((result) => result.tracks),
  similar: (credentials: SubsonicCredentials, track: { title: string; artist?: string }, limit: number, signal?: AbortSignal) =>
    call<{ tracks: CatalogTrack[] }>(credentials, `/similar?${new URLSearchParams({ title: track.title, limit: String(limit), ...(track.artist ? { artist: track.artist } : {}) })}`, { signal }).then((result) => result.tracks),
  resolve: (credentials: SubsonicCredentials, url: string, signal?: AbortSignal) => call<ResolvedLink>(credentials, `/resolve?url=${encodeURIComponent(url)}`, { signal }),
  download: (credentials: SubsonicCredentials, songIds: string[]) => call<{ queued: number; missing: number; unverified?: number }>(credentials, '/downloads', { method: 'POST', body: JSON.stringify({ songIds }) }),
  queue: (credentials: SubsonicCredentials) => call<DownloadJob[]>(credentials, '/queue'),
  clearCompleted: (credentials: SubsonicCredentials) => call<void>(credentials, '/queue/completed', { method: 'DELETE' }),
}

// Opus is a little better than AAC at the same size, but only some browsers decode it from a plain audio element.
function canPlayOpus(): boolean {
  return typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/webm; codecs="opus"') === 'probably'
}

// Audio elements can't send headers, so the stream URL carries the Subsonic credentials the backend checks.
export function catalogStreamUrl(credentials: SubsonicCredentials, track: CatalogTrack): string {
  const params = new URLSearchParams({ u: credentials.username, t: credentials.token, s: credentials.salt, direct: '1' })
  if (canPlayOpus()) params.set('codec', 'any')
  if (track.youtubeId) params.set('video', track.youtubeId)
  else {
    params.set('title', track.title)
    if (track.artists[0]) params.set('artist', track.artists[0])
    if (track.album) params.set('album', track.album)
    if (track.explicit) params.set('explicit', '1')
  }
  if (track.duration) params.set('duration', String(track.duration))
  return `/api/downtify/stream?${params}`
}

export function catalogTrackToSong(credentials: SubsonicCredentials, track: CatalogTrack): SubsonicSong {
  return {
    id: `external:${track.id}`,
    title: track.title,
    artist: track.artists.join(', ') || undefined,
    album: track.album,
    duration: track.duration,
    year: Number(track.year) || undefined,
    track: track.trackNumber,
    external: { streamUrl: catalogStreamUrl(credentials, track), coverUrl: track.coverUrl, catalogId: track.id, explicit: track.explicit || undefined },
  }
}

export interface PlaylistImport {
  id: string
  name: string
  playlistId: string
  total: number
  added: number
  failed: number
  pending: number
  running: boolean
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface FailedImportSong {
  title: string
  artists: string[]
  reason: string
}

export const importApi = {
  start: (credentials: SubsonicCredentials, url: string) => call<PlaylistImport>(credentials, '/imports', { method: 'POST', body: JSON.stringify({ url }) }),
  list: (credentials: SubsonicCredentials) => call<PlaylistImport[]>(credentials, '/imports'),
  retry: (credentials: SubsonicCredentials, id: string) => call<PlaylistImport>(credentials, `/imports/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  failures: (credentials: SubsonicCredentials, id: string) => call<FailedImportSong[]>(credentials, `/imports/${encodeURIComponent(id)}/failures`),
}

export interface ExplicitCandidate {
  file: string
  title: string
  artist: string
  videoId: string
}

export interface ExplicitRefreshStatus {
  phase: 'idle' | 'scanning' | 'scanned' | 'replacing' | 'done'
  checked: number
  total: number
  found: ExplicitCandidate[]
  replace: { total: number; done: number; failed: { title: string; artist: string; reason: string }[] }
  error?: string
}

export const explicitApi = {
  status: (credentials: SubsonicCredentials) => call<ExplicitRefreshStatus>(credentials, '/explicit'),
  scan: (credentials: SubsonicCredentials) => call<ExplicitRefreshStatus>(credentials, '/explicit/scan', { method: 'POST' }),
  cancel: (credentials: SubsonicCredentials) => call<void>(credentials, '/explicit/cancel', { method: 'POST' }),
  replace: (credentials: SubsonicCredentials, files: string[]) => call<ExplicitRefreshStatus>(credentials, '/explicit/replace', { method: 'POST', body: JSON.stringify({ files }) }),
}

export interface LibraryFile {
  file: string
  title: string
  artists: string[]
  duration?: number
  explicit: boolean
  codec: string
}

export interface DeleteResult {
  deleted: number
  failed: { file: string; reason: string }[]
  scanStarted: boolean
}

export const libraryApi = {
  list: (credentials: SubsonicCredentials) => call<LibraryFile[]>(credentials, '/library'),
  remove: (credentials: SubsonicCredentials, files: string[]) => call<DeleteResult>(credentials, '/library/delete', { method: 'POST', body: JSON.stringify({ files }) }),
}

export interface StorageGroup {
  id: string
  files: number
  bytes: number
}

export interface DuplicateGroup {
  kind: 'exact' | 'likely'
  title: string
  artist: string
  bytes: number
  files: { file: string; bytes: number; provider: string; codec: string; bitrate?: number }[]
}

export interface StorageUsage {
  days: number
  library: { files: number; bytes: number; byProvider: StorageGroup[]; byFormat: StorageGroup[]; byLocation: StorageGroup[] }
  period: { files: number; bytes: number }
  growth: { points: { day: string; bytes: number; files: number; estimated: boolean }[]; changeBytes: number; perDayBytes: number | null }
  downloads: { completed: number; skipped: number; failed: number; byProvider: StorageGroup[] }
  duplicates: { groups: number; files: number; bytes: number; examples: DuplicateGroup[] }
  working: { files: number; bytes: number }
  disk: { total: number; used: number; free: number; daysLeft: number | null } | null
}

export interface StorageScan {
  folders: { id: string; path: string; files: number; bytes: number; kinds: Record<string, { files: number; bytes: number }> }[]
  leftovers: { files: number; bytes: number }
  orphans: { files: number; bytes: number }
  scannedAt: string
}

export const storageApi = {
  usage: (credentials: SubsonicCredentials, days: number) => call<StorageUsage>(credentials, `/storage?days=${days}`),
  scan: (credentials: SubsonicCredentials, refresh: boolean) => call<StorageScan>(credentials, `/storage/scan${refresh ? '?refresh=true' : ''}`),
}

export interface LyricLine {
  time: number
  text: string
}

export interface Lyrics {
  synced: LyricLine[] | null
  plain: string | null
}

export async function fetchLyricsFromServer(credentials: SubsonicCredentials, query: { title: string; artist: string; album?: string; duration?: number }, signal?: AbortSignal): Promise<Lyrics> {
  const params = new URLSearchParams({ title: query.title, artist: query.artist })
  if (query.album) params.set('album', query.album)
  if (query.duration) params.set('duration', String(Math.round(query.duration)))
  const response = await fetch(`/api/lyrics?${params}`, { signal, headers: { 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt } })
  if (!response.ok) throw new Error(`Lyrics request failed with HTTP ${response.status}`)
  return (await response.json()) as Lyrics
}

export interface UpgradeFound {
  file: string
  title: string
  artist: string
  peer: string
  sizeBytes: number
  similarity: number
}

export interface UpgradeStatus {
  phase: 'idle' | 'scanning' | 'scanned' | 'applying' | 'done'
  checked: number
  total: number
  current?: string
  found: UpgradeFound[]
  apply: { total: number; done: number; failed: { title: string; artist: string; reason: string }[] }
  upgradedEver: number
  auto: { everyMinutes: number; lastRunAt?: number }
  error?: string
}

export const qualityApi = {
  status: (credentials: SubsonicCredentials) => call<UpgradeStatus>(credentials, '/quality'),
  scan: (credentials: SubsonicCredentials, limit: number) => call<UpgradeStatus>(credentials, '/quality/scan', { method: 'POST', body: JSON.stringify({ limit }) }),
  cancel: (credentials: SubsonicCredentials) => call<void>(credentials, '/quality/cancel', { method: 'POST' }),
  discard: (credentials: SubsonicCredentials) => call<void>(credentials, '/quality/discard', { method: 'POST' }),
  apply: (credentials: SubsonicCredentials, files: string[]) => call<UpgradeStatus>(credentials, '/quality/apply', { method: 'POST', body: JSON.stringify({ files }) }),
}
