import { normalize, sameRecording } from './matching.ts'

export interface DowntifyConfig {
  url: string
  token: string
  // An admin account's sign-in, for the actions Downtify only allows an admin's browser session: deleting and replacing
  // files and storage statistics.
  adminLogin?: { username: string; password: string }
}

export interface DowntifySong {
  song_id: string
  name: string
  artists?: string[]
  artist?: string
  album_name?: string
  cover_url?: string
  duration?: number
  explicit?: boolean
  year?: string
  source?: string
  track_number?: number
  youtube_id?: string
  // Downtify's other fields are passed back unchanged when a song is queued.
  [key: string]: unknown
}

interface DowntifyJob {
  song: DowntifySong
  status: string
  progress?: number
  message?: string
  position?: number | null
  provider?: string
}

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

export interface LibraryTrack {
  file: string
  title: string
  artists: string[]
  duration?: number
  explicit: boolean
  codec: string
}

export interface QueueJob {
  id: string
  title: string
  artists: string[]
  album?: string
  coverUrl?: string
  status: 'queued' | 'downloading' | 'done' | 'error'
  progress: number
  message?: string
  position?: number
}

export interface StorageGroup {
  id: string
  files: number
  bytes: number
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

export interface DuplicateGroup {
  kind: 'exact' | 'likely'
  title: string
  artist: string
  bytes: number
  files: { file: string; bytes: number; provider: string; codec: string; bitrate?: number }[]
}

export interface StorageScan {
  folders: { id: string; path: string; files: number; bytes: number; kinds: Record<string, { files: number; bytes: number }> }[]
  leftovers: { files: number; bytes: number }
  orphans: { files: number; bytes: number }
  scannedAt: string
}

export class DowntifyError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DowntifyError'
    this.status = status
  }
}

const SONG_CACHE_LIMIT = 5000
const DELETE_BATCH_SIZE = 200
interface RawGroup {
  id: string
  files: number
  bytes: number
}

interface RawUsage {
  days: number
  library?: { files?: number; bytes?: number; by_provider?: RawGroup[]; by_format?: RawGroup[]; by_location?: RawGroup[] }
  period?: { files?: number; bytes?: number }
  growth?: { points?: { day: string; bytes: number; files: number; estimated?: boolean }[]; change?: { bytes?: number }; per_day_bytes?: number | null }
  downloads?: { completed?: number; skipped?: number; failed?: number; by_provider?: RawGroup[] }
  duplicates?: { groups?: number; files?: number; bytes?: number; examples?: { kind: 'exact' | 'likely'; title: string; artist: string; bytes: number; files: { file: string; bytes: number; provider: string; codec: string; bitrate?: number }[] }[] }
  working?: { files?: number; bytes?: number }
  disk?: { total: number; used: number; free: number; days_left?: number | null } | null
}
const JOB_STATUSES = new Set(['queued', 'downloading', 'done', 'error'])
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
export const ADMIN_LOGIN_HINT = 'Downtify needs an admin account for this. Set DOWNTIFY_ADMIN_USERNAME and DOWNTIFY_ADMIN_PASSWORD on the Odeon server.'

export interface VideoLookup {
  title: string
  artist?: string
  album?: string
  duration?: number
  explicit?: boolean
}

const searchTextFor = (track: VideoLookup) => `${track.artist ?? ''} ${track.title}`.trim()
const lengthWithin = (song: DowntifySong, duration: number | undefined, seconds: number) => !duration || !song.duration || Math.abs(song.duration - duration) <= seconds

// A candidate counts as the same recording only when title, version, explicit flag, artist and length all agree.
const EXACT_SECONDS = 3
const NOT_MATCHED_SOURCES = new Set(['youtube', 'soundcloud'])

function artistMatches(song: DowntifySong, artist: string | undefined): boolean {
  const wanted = normalize(artist ?? '')
  if (!wanted) return true
  return [song.artist, ...(song.artists ?? [])].some((name) => {
    const candidate = normalize(name ?? '')
    return candidate.length > 0 && (candidate.includes(wanted) || wanted.includes(candidate))
  })
}

function albumMatches(song: DowntifySong, album: string | undefined): boolean {
  const wanted = normalize(album ?? '')
  const candidate = normalize(song.album_name ?? '')
  return wanted.length > 0 && candidate.length > 0 && (candidate.includes(wanted) || wanted.includes(candidate))
}

function isExactMatch(song: DowntifySong, track: VideoLookup): boolean {
  return sameRecording(song.name, track.title) && Boolean(song.explicit) === Boolean(track.explicit) && lengthWithin(song, track.duration, EXACT_SECONDS) && artistMatches(song, track.artist)
}

// Lower is closer: the length difference, with a small penalty for a different album.
function closeness(song: DowntifySong, track: VideoLookup): number {
  const lengthGap = track.duration && song.duration ? Math.abs(song.duration - track.duration) : 0
  return lengthGap + (albumMatches(song, track.album) ? 0 : 2)
}

function toTrack(song: DowntifySong): CatalogTrack {
  const artists = song.artists?.length ? song.artists : song.artist ? [song.artist] : []
  // YouTube Music results use the video id as song_id; Spotify/Deezer tracks only get a video when Downtify matches them at download time.
  const youtubeId = song.source === 'youtube' && YOUTUBE_ID_PATTERN.test(song.song_id) ? song.song_id : undefined
  return { id: song.song_id, youtubeId, title: song.name, artists, album: song.album_name || undefined, coverUrl: song.cover_url || undefined, duration: song.duration, year: song.year || undefined, explicit: Boolean(song.explicit), trackNumber: song.track_number }
}

export function createDowntifyClient(config: DowntifyConfig) {
  // Downloads are requested by id: the server keeps the full song objects it handed out, so clients never send
  // arbitrary objects for Downtify to fetch.
  const songs = new Map<string, DowntifySong>()
  const videoIds = new Map<string, string>()

  function remember(list: DowntifySong[]) {
    for (const song of list) {
      if (!song?.song_id) continue
      songs.delete(song.song_id)
      songs.set(song.song_id, song)
    }
    while (songs.size > SONG_CACHE_LIMIT) songs.delete(songs.keys().next().value as string)
  }

  // Downtify's admin routes need a signed-in browser session; a device token is refused even for an admin's account.
  let adminCookiePromise: Promise<string> | undefined

  async function signInAsAdmin(): Promise<string> {
    if (!config.adminLogin) throw new DowntifyError(403, 'admin_login_missing')
    const response = await fetch(`${config.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config.adminLogin), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new DowntifyError(response.status === 401 ? 403 : response.status, 'admin_login_failed')
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .find((value) => value.startsWith('downtify_session='))
    if (!cookie) throw new DowntifyError(502, 'admin_login_failed')
    return cookie
  }

  function adminCookie(refresh = false): Promise<string> {
    if (refresh) adminCookiePromise = undefined
    adminCookiePromise ??= signInAsAdmin().catch((error: unknown) => {
      adminCookiePromise = undefined
      throw error
    })
    return adminCookiePromise
  }

  async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000, auth: 'user' | 'admin' = 'user'): Promise<T> {
    const send = (credential: Record<string, string>) =>
      fetch(`${config.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...credential, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) })
    let response = await send(auth === 'admin' ? { Cookie: await adminCookie() } : { Authorization: `Bearer ${config.token}` })
    // The session may have expired or been revoked, so an admin request is retried once with a fresh sign-in.
    if (auth === 'admin' && (response.status === 401 || response.status === 403)) response = await send({ Cookie: await adminCookie(true) })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: unknown }
      const code = typeof body.detail === 'object' && body.detail !== null ? (body.detail as { code?: unknown }).code : undefined
      throw new DowntifyError(response.status, typeof body.detail === 'string' ? body.detail : typeof code === 'string' ? code : `Downtify returned HTTP ${response.status}`)
    }
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async function youtubeCandidates(query: string): Promise<DowntifySong[]> {
    const results = await request<DowntifySong[]>(`/api/songs/search?query=${encodeURIComponent(query)}`)
    return results.filter((song) => song.source === 'youtube' && YOUTUBE_ID_PATTERN.test(song.song_id))
  }

  // A clean edit has the explicit version's title and length, so only YouTube Music's explicit flag tells them apart.
  // Both versions are often separate releases, and the explicit one may only rank high when the query asks for it.
  async function explicitMatch(track: VideoLookup, firstResults?: DowntifySong[]): Promise<string | undefined> {
    const pick = (candidates: DowntifySong[]) => candidates.find((song) => song.explicit && sameRecording(song.name, track.title) && lengthWithin(song, track.duration, 10))?.song_id
    return pick(firstResults ?? (await youtubeCandidates(searchTextFor(track)))) ?? pick(await youtubeCandidates(`${searchTextFor(track)} explicit`))
  }

  interface VideoMatch {
    videoId?: string
    exact: boolean
    firstResult?: string
  }

  // `exact` means a YouTube Music result with the same title and version, explicit flag, artist and length (3 s). When no
  // result is that close, `videoId` is the best looser candidate (length within 10 s) and `exact` is false.
  async function matchVideo(track: VideoLookup): Promise<VideoMatch> {
    const base = searchTextFor(track)
    const queries = [...new Set([base, track.album ? `${base} ${track.album}` : '', track.explicit ? `${base} explicit` : ''].filter(Boolean))]
    let loose: DowntifySong | undefined
    let firstResult: string | undefined
    for (const query of queries) {
      const candidates = await youtubeCandidates(query)
      firstResult ??= candidates[0]?.song_id
      const exact = candidates.filter((song) => isExactMatch(song, track)).sort((a, b) => closeness(a, track) - closeness(b, track))[0]
      if (exact) return { videoId: exact.song_id, exact: true, firstResult }
      loose ??= candidates.find((song) => lengthWithin(song, track.duration, 10) && (!track.explicit || song.explicit))
    }
    return { videoId: loose?.song_id, exact: false, firstResult }
  }

  // The video is forced only when a result is verified as the same recording; otherwise Downtify's own matcher decides
  // and the song is reported as unverified.
  async function withMatchedVideo(song: DowntifySong): Promise<{ song: DowntifySong; verified: boolean }> {
    if (NOT_MATCHED_SOURCES.has(song.source ?? '') || song.youtube_id) return { song, verified: true }
    const track = toTrack(song)
    const match = await matchVideo({ title: track.title, artist: track.artists[0], album: track.album, duration: track.duration, explicit: track.explicit }).catch(() => undefined)
    return match?.exact && match.videoId ? { song: { ...song, youtube_id: match.videoId }, verified: true } : { song, verified: false }
  }

  return {
    async search(query: string): Promise<CatalogTrack[]> {
      const results = await request<DowntifySong[]>(`/api/songs/search?query=${encodeURIComponent(query)}`)
      remember(results)
      return results.map(toTrack)
    },

    // YouTube Music's radio mix for a song: its rows are YouTube videos, even when Downtify leaves out their source.
    async similar(track: { title: string; artist?: string }, limit: number): Promise<CatalogTrack[]> {
      const params = new URLSearchParams({ track: track.title, limit: String(limit) })
      if (track.artist) params.set('artist', track.artist)
      const result = await request<{ tracks?: DowntifySong[] }>(`/api/similar/tracks?${params}`, {}, 30_000)
      const tracks = (result.tracks ?? []).map((song) => ({ ...song, source: song.source ?? 'youtube' }))
      remember(tracks)
      return tracks.map(toTrack)
    },

    async resolve(url: string): Promise<ResolvedLink> {
      const result = await request<{ kind: string; name: string; subtitle?: string; cover_url?: string; year?: string; tracks?: DowntifySong[] }>(`/api/url/resolve?url=${encodeURIComponent(url)}`, {}, 60_000)
      const tracks = result.tracks ?? []
      remember(tracks)
      return { kind: result.kind, name: result.name, subtitle: result.subtitle || undefined, coverUrl: result.cover_url || undefined, year: result.year || undefined, tracks: tracks.map(toTrack) }
    },

    async enqueue(songIds: string[]): Promise<{ queued: number; missing: number; unverified: number }> {
      const known = songIds.map((id) => songs.get(id)).filter((song): song is DowntifySong => Boolean(song))
      const prepared: DowntifySong[] = []
      let unverified = 0
      for (let start = 0; start < known.length; start += 6) {
        for (const result of await Promise.all(known.slice(start, start + 6).map(withMatchedVideo))) {
          prepared.push(result.song)
          if (!result.verified) unverified++
        }
      }
      if (prepared.length > 0) await request('/api/download/batch', { method: 'POST', body: JSON.stringify({ songs: prepared, generate_m3u: false }) })
      return { queued: prepared.length, missing: songIds.length - prepared.length, unverified }
    },

    songFor(id: string): DowntifySong | undefined {
      return songs.get(id)
    },

    // Downtify takes the song object as-is; a youtube_id in it forces that video as the audio source.
    async enqueueSongs(list: DowntifySong[]): Promise<void> {
      if (list.length === 0) return
      remember(list)
      await request('/api/download/batch', { method: 'POST', body: JSON.stringify({ songs: list, generate_m3u: false }) })
    },

    async alternativeVideos(track: VideoLookup): Promise<string[]> {
      const close = (await youtubeCandidates(searchTextFor(track))).filter((song) => lengthWithin(song, track.duration, 20))
      const ordered = track.explicit ? [...close.filter((song) => song.explicit), ...close.filter((song) => !song.explicit)] : close
      return ordered.map((song) => song.song_id)
    },

    explicitVideoId(track: VideoLookup): Promise<string | undefined> {
      return track.explicit ? explicitMatch(track) : Promise.resolve(undefined)
    },

    async matchedVideoId(track: VideoLookup): Promise<string | undefined> {
      const match = await matchVideo(track)
      return match.exact ? match.videoId : undefined
    },

    async queue(asAdmin = false): Promise<QueueJob[]> {
      const jobs = await request<DowntifyJob[]>('/api/queue', {}, 30_000, asAdmin ? 'admin' : 'user')
      return jobs.map((job) => ({
        ...toTrack(job.song),
        status: (JOB_STATUSES.has(job.status) ? job.status : 'queued') as QueueJob['status'],
        progress: job.progress ?? 0,
        message: job.message || undefined,
        position: job.position ?? undefined,
      }))
    },

    async clearCompleted(): Promise<void> {
      await request('/api/queue/completed', { method: 'DELETE' })
    },

    async libraryTracks(): Promise<LibraryTrack[]> {
      const rows = await request<{ file?: string; title?: string; artist?: string; artists?: string[]; duration?: number; explicit?: boolean; codec?: string }[]>('/tracks', {}, 120_000, 'admin')
      return rows
        .filter((row) => row.file && row.title)
        .map((row) => ({ file: row.file as string, title: row.title as string, artists: row.artists?.length ? row.artists : row.artist ? [row.artist] : [], duration: row.duration, explicit: Boolean(row.explicit), codec: row.codec ?? '' }))
    },

    // Removes the files from disk and from Downtify's own listings and playlists. Needs an admin token. Files are
    // given as `libraryTracks()` lists them; Downtify confines each path to its downloads folder.
    async deleteFiles(files: string[]): Promise<{ deleted: number; failed: { file: string; reason: string }[] }> {
      let deleted = 0
      const failed: { file: string; reason: string }[] = []
      for (let start = 0; start < files.length; start += DELETE_BATCH_SIZE) {
        const batch = files.slice(start, start + DELETE_BATCH_SIZE)
        const result = await request<{ results?: Record<string, { deleted?: boolean; released?: boolean; error?: string }> }>('/delete/batch', { method: 'DELETE', body: JSON.stringify({ files: batch }) }, 120_000, 'admin')
        for (const file of batch) {
          const outcome = result?.results?.[file]
          if (outcome?.deleted || outcome?.released) deleted++
          else failed.push({ file, reason: outcome?.error ?? 'Downtify did not delete it' })
        }
      }
      return { deleted, failed }
    },

    async storageUsage(days: number): Promise<StorageUsage> {
      const raw = await request<RawUsage>(`/api/library/usage?days=${days}`, {}, 120_000, 'admin')
      const groups = (list?: RawGroup[]): StorageGroup[] => (list ?? []).map((group) => ({ id: group.id, files: group.files, bytes: group.bytes }))
      return {
        days: raw.days,
        library: { files: raw.library?.files ?? 0, bytes: raw.library?.bytes ?? 0, byProvider: groups(raw.library?.by_provider), byFormat: groups(raw.library?.by_format), byLocation: groups(raw.library?.by_location) },
        period: { files: raw.period?.files ?? 0, bytes: raw.period?.bytes ?? 0 },
        growth: {
          points: (raw.growth?.points ?? []).map((point) => ({ day: point.day, bytes: point.bytes, files: point.files, estimated: Boolean(point.estimated) })),
          changeBytes: raw.growth?.change?.bytes ?? 0,
          perDayBytes: raw.growth?.per_day_bytes ?? null,
        },
        downloads: { completed: raw.downloads?.completed ?? 0, skipped: raw.downloads?.skipped ?? 0, failed: raw.downloads?.failed ?? 0, byProvider: groups(raw.downloads?.by_provider) },
        duplicates: {
          groups: raw.duplicates?.groups ?? 0,
          files: raw.duplicates?.files ?? 0,
          bytes: raw.duplicates?.bytes ?? 0,
          examples: (raw.duplicates?.examples ?? []).map((group) => ({
            kind: group.kind,
            title: group.title,
            artist: group.artist,
            bytes: group.bytes,
            files: group.files.map((entry) => ({ file: entry.file, bytes: entry.bytes, provider: entry.provider, codec: entry.codec, bitrate: entry.bitrate })),
          })),
        },
        working: { files: raw.working?.files ?? 0, bytes: raw.working?.bytes ?? 0 },
        disk: raw.disk ? { total: raw.disk.total, used: raw.disk.used, free: raw.disk.free, daysLeft: raw.disk.days_left ?? null } : null,
      }
    },

    async storageScan(refresh: boolean): Promise<StorageScan> {
      const raw = await request<{ folders?: StorageScan['folders']; leftovers?: { files: number; bytes: number }; orphans?: { files: number; bytes: number }; scanned_at?: string }>(`/api/library/usage/scan${refresh ? '?refresh=true' : ''}`, {}, 300_000, 'admin')
      return { folders: raw.folders ?? [], leftovers: { files: raw.leftovers?.files ?? 0, bytes: raw.leftovers?.bytes ?? 0 }, orphans: { files: raw.orphans?.files ?? 0, bytes: raw.orphans?.bytes ?? 0 }, scannedAt: raw.scanned_at ?? '' }
    },

    // Runs as a Downtify queue job with the id `replace:<file>`; the file keeps its path, tags and playlists.
    async replaceAudio(file: string, videoId: string): Promise<void> {
      await request('/api/library/replace', { method: 'POST', body: JSON.stringify({ file, video_id: videoId }) }, 30_000, 'admin')
    },

    // Spotify and Deezer tracks have no video until one is matched, so they're looked up on YouTube Music the same way
    // downloads are. Without a verified match the closest result within 10 seconds plays; with no length to compare, the first.
    async findVideoId(track: VideoLookup): Promise<string | undefined> {
      const key = `${track.artist ?? ''}\n${track.title}\n${track.album ?? ''}\n${track.duration ?? ''}\n${track.explicit ? 'explicit' : ''}`
      const cached = videoIds.get(key)
      if (cached) return cached
      const match = await matchVideo(track)
      const videoId = match.videoId ?? (track.duration ? undefined : match.firstResult)
      if (videoId) {
        if (videoIds.size >= SONG_CACHE_LIMIT) videoIds.clear()
        videoIds.set(key, videoId)
      }
      return videoId
    },

    stream(videoId: string, duration: number | undefined, range: string | undefined): Promise<Response> {
      const params = new URLSearchParams({ video_id: videoId })
      if (duration) params.set('duration', String(Math.round(duration)))
      return fetch(`${config.url}/api/stream/file?${params}`, { headers: { Authorization: `Bearer ${config.token}`, ...(range ? { Range: range } : {}) }, signal: AbortSignal.timeout(120_000) })
    },

    // Downtify answers at once and keeps downloading into its stream cache, so a later stream() starts immediately.
    async prefetch(videoId: string): Promise<void> {
      await request('/api/stream/prefetch', { method: 'POST', body: JSON.stringify({ video_id: videoId }) })
    },
  }
}

export type DowntifyClient = ReturnType<typeof createDowntifyClient>
