import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CatalogTrack, DowntifyClient, DowntifySong, QueueJob } from './downtify.ts'
import { pickMatch, searchQueriesFor } from './matching.ts'
import { navidrome, type SubsonicAuth } from './navidrome.ts'

type EntryState = 'matching' | 'downloading' | 'added' | 'failed'

// A forced video would be wrong for these, which are not Spotify or Deezer tracks.
const NOT_IMPORT_MATCHED = new Set(['youtube', 'soundcloud'])

interface ImportEntry {
  track: CatalogTrack
  // Kept so a retry can re-queue the song after a server restart, when Downtify's in-memory results are gone.
  song?: DowntifySong
  state: EntryState
  songId?: string
  queueId?: string
  queuedAt?: number
  downloadedAt?: number
  triedVideos: string[]
  attempts: number
  reason?: string
}

interface PlaylistImport {
  id: string
  owner: string
  name: string
  sourceUrl: string
  playlistId: string
  entries: ImportEntry[]
  startedAt: number
  finishedAt?: number
  error?: string
}

export interface ImportSummary {
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

export interface FailedSong {
  title: string
  artists: string[]
  reason: string
}

export class ImportError extends Error {
  readonly status: 400 | 404 | 409 | 429

  constructor(status: 400 | 404 | 409 | 429, message: string) {
    super(message)
    this.name = 'ImportError'
    this.status = status
  }
}

const MAX_TRACKS = 500
const MAX_RUNNING_PER_USER = 3
const POLL_INTERVAL_MS = 5_000
// Navidrome's watcher usually imports a finished file within seconds; this allows for slow scans.
const MATCH_WINDOW_MS = 3 * 60_000
const MISSING_JOB_WINDOW_MS = 10 * 60_000
const MAX_RUNTIME_MS = 6 * 60 * 60_000
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60_000
const ENQUEUE_CHUNK = 100
// Automatic attempts per run: the first download plus one alternative YouTube video.
const ATTEMPTS_PER_RUN = 2

const REASONS = {
  interrupted: 'Stopped by a server restart',
  removed: 'The download disappeared from the queue',
  notInLibrary: "Downloaded, but it didn't show up in the library",
  noAudio: 'No downloadable version was found on YouTube Music',
  timedOut: 'Timed out',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++])
    }),
  )
}

function summarize(job: PlaylistImport): ImportSummary {
  const count = (state: EntryState) => job.entries.filter((entry) => entry.state === state).length
  return {
    id: job.id,
    name: job.name,
    playlistId: job.playlistId,
    total: job.entries.length,
    added: count('added'),
    failed: count('failed'),
    pending: count('matching') + count('downloading'),
    running: job.finishedAt === undefined,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  }
}

async function findInLibrary(auth: SubsonicAuth, track: CatalogTrack): Promise<string | undefined> {
  for (const query of searchQueriesFor(track)) {
    const match = pickMatch(track, await navidrome.searchSongs(auth, query))
    if (match) return match.id
  }
  return undefined
}

// Imports run here instead of in the browser so they keep going when the app is closed. They're saved to disk
// (without credentials), so after a restart an interrupted import shows up as stopped and can be resumed with Retry.
export function createPlaylistImporter(downtify: DowntifyClient, storePath: string | undefined) {
  const imports = new Map<string, PlaylistImport>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function save() {
    if (!storePath || saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      const temporary = `${storePath}.tmp`
      void mkdir(dirname(storePath), { recursive: true })
        .then(() => writeFile(temporary, JSON.stringify([...imports.values()]), { mode: 0o600 }))
        .then(() => rename(temporary, storePath))
        .catch((error: unknown) => console.error('Saving imports failed:', error))
    }, 1000)
  }

  async function load() {
    if (!storePath) return
    try {
      const saved = JSON.parse(await readFile(storePath, 'utf8')) as PlaylistImport[]
      for (const job of saved) {
        if (job.finishedAt === undefined) {
          for (const entry of job.entries) if (entry.state !== 'added' && entry.state !== 'failed') Object.assign(entry, { state: 'failed', reason: REASONS.interrupted })
          job.finishedAt = Date.now()
          job.error = REASONS.interrupted
        }
        imports.set(job.id, job)
      }
      console.log(`Loaded ${imports.size} playlist imports`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Loading imports failed:', error)
    }
  }

  function prune() {
    const cutoff = Date.now() - KEEP_FINISHED_MS
    for (const [id, job] of imports) if (job.finishedAt !== undefined && job.finishedAt < cutoff) imports.delete(id)
  }

  async function syncPlaylist(job: PlaylistImport, auth: SubsonicAuth) {
    const songIds = job.entries.filter((entry) => entry.state === 'added' && entry.songId).map((entry) => entry.songId as string)
    await navidrome.setSongs(auth, job.playlistId, songIds)
  }

  async function markAddedIfInLibrary(entry: ImportEntry, auth: SubsonicAuth): Promise<boolean> {
    const songId = await findInLibrary(auth, entry.track).catch(() => undefined)
    if (!songId) return false
    Object.assign(entry, { state: 'added', songId, reason: undefined })
    return true
  }

  // Queues the song with a YouTube video it hasn't tried yet. The first attempt lets Downtify choose the match, except
  // for explicit songs: Downtify's matcher can't tell them from their clean edits, so an explicit video is forced.
  async function queueNextAttempt(entry: ImportEntry): Promise<boolean> {
    const song = entry.song ?? downtify.songFor(entry.track.id)
    if (!song) return false
    entry.song = song
    const lookup = { title: entry.track.title, artist: entry.track.artists[0], album: entry.track.album, duration: entry.track.duration, explicit: entry.track.explicit }
    let videoId: string | undefined
    if (entry.attempts > 0 || entry.triedVideos.length > 0) {
      const candidates = await downtify.alternativeVideos(lookup).catch(() => [] as string[])
      videoId = candidates.find((candidate) => !entry.triedVideos.includes(candidate))
      if (!videoId) return false
      entry.triedVideos.push(videoId)
    } else if (!NOT_IMPORT_MATCHED.has(song.source ?? '')) {
      videoId = await downtify.matchedVideoId(lookup).catch(() => undefined)
      if (videoId) entry.triedVideos.push(videoId)
    }
    // A forced video gets its own queue id, so the next attempt can't be confused with the earlier failed job.
    const queued: DowntifySong = videoId ? { ...song, song_id: `${song.song_id}~${videoId}`, youtube_id: videoId } : song
    await downtify.enqueueSongs([queued])
    Object.assign(entry, { state: 'downloading', queueId: queued.song_id, queuedAt: Date.now(), downloadedAt: undefined, reason: undefined })
    entry.attempts++
    return true
  }

  async function failOrRetry(entry: ImportEntry, auth: SubsonicAuth, reason: string, attemptLimit: number) {
    if (await markAddedIfInLibrary(entry, auth)) return
    if (entry.attempts < attemptLimit && (await queueNextAttempt(entry).catch(() => false))) return
    Object.assign(entry, { state: 'failed', reason })
  }

  async function run(job: PlaylistImport, auth: SubsonicAuth, entries: ImportEntry[], attemptLimit: number) {
    job.finishedAt = undefined
    job.error = undefined
    save()
    try {
      await forEachLimited(entries, 4, async (entry) => {
        if (!(await markAddedIfInLibrary(entry, auth))) entry.state = 'downloading'
      })
      await syncPlaylist(job, auth)
      save()

      const toQueue = entries.filter((entry) => entry.state === 'downloading')
      for (let start = 0; start < toQueue.length; start += ENQUEUE_CHUNK) {
        const chunk = toQueue.slice(start, start + ENQUEUE_CHUNK)
        await forEachLimited(chunk, 4, async (entry) => {
          if (!(await queueNextAttempt(entry).catch(() => false))) Object.assign(entry, { state: 'failed', reason: entry.attempts > 0 ? REASONS.noAudio : 'This song is no longer available to download. Import the link again.' })
        })
      }
      save()

      const startedRun = Date.now()
      while (entries.some((entry) => entry.state === 'downloading') && Date.now() - startedRun < MAX_RUNTIME_MS) {
        await sleep(POLL_INTERVAL_MS)
        const jobs = new Map<string, QueueJob>((await downtify.queue().catch(() => [] as QueueJob[])).map((queued) => [queued.id, queued]))
        let changed = false

        for (const entry of entries.filter((candidate) => candidate.state === 'downloading')) {
          const queued = jobs.get(entry.queueId ?? entry.track.id)
          if (!queued) {
            // Finished jobs vanish when Downtify restarts or its queue is cleared; the file may still be in the library.
            if (Date.now() - (entry.queuedAt ?? startedRun) > MISSING_JOB_WINDOW_MS) await failOrRetry(entry, auth, REASONS.removed, attemptLimit)
          } else if (queued.status === 'error') {
            await failOrRetry(entry, auth, queued.message ?? 'Download failed', attemptLimit)
          } else if (queued.status === 'done') {
            entry.downloadedAt ??= Date.now()
            if (await markAddedIfInLibrary(entry, auth)) changed = true
            else if (Date.now() - entry.downloadedAt > MATCH_WINDOW_MS) Object.assign(entry, { state: 'failed', reason: REASONS.notInLibrary })
          }
          if (entry.state === 'added') changed = true
        }
        if (changed) {
          await syncPlaylist(job, auth).catch((error: unknown) => console.error(`Import ${job.id}: playlist update failed`, error))
          save()
        }
      }

      for (const entry of entries) if (entry.state === 'downloading' || entry.state === 'matching') await failOrRetry(entry, auth, REASONS.timedOut, 0)
      await syncPlaylist(job, auth).catch(() => undefined)
    } catch (error) {
      job.error = error instanceof Error ? error.message : 'Import failed'
      console.error(`Import ${job.id} failed:`, job.error)
    } finally {
      job.finishedAt = Date.now()
      save()
    }
  }

  function owned(username: string, id: string): PlaylistImport {
    const job = imports.get(id)
    if (!job || job.owner !== username) throw new ImportError(404, 'Import not found')
    return job
  }

  const ready = load()

  return {
    async start(auth: SubsonicAuth, url: string): Promise<ImportSummary> {
      await ready
      prune()
      const running = [...imports.values()].filter((job) => job.owner === auth.username && job.finishedAt === undefined).length
      if (running >= MAX_RUNNING_PER_USER) throw new ImportError(429, `You already have ${running} imports running. Wait for one to finish.`)

      const link = await downtify.resolve(url)
      if (link.kind !== 'playlist' && link.kind !== 'album') throw new ImportError(400, 'Only playlist and album links can be imported as a playlist')
      if (link.tracks.length === 0) throw new ImportError(404, 'This link has no songs')
      if (link.tracks.length > MAX_TRACKS) throw new ImportError(400, `Playlists with more than ${MAX_TRACKS} songs can't be imported`)

      const playlistId = await navidrome.createPlaylist(auth, link.name)
      await navidrome.setComment(auth, playlistId, `Imported from ${url}`).catch(() => undefined)
      const job: PlaylistImport = {
        id: crypto.randomUUID(),
        owner: auth.username,
        name: link.name,
        sourceUrl: url,
        playlistId,
        entries: link.tracks.map((track) => ({ track, song: downtify.songFor(track.id), state: 'matching', triedVideos: [], attempts: 0 })),
        startedAt: Date.now(),
      }
      imports.set(job.id, job)
      void run(job, auth, job.entries, ATTEMPTS_PER_RUN)
      return summarize(job)
    },

    // Each retry gets fresh automatic attempts, each one with a YouTube version the song hasn't tried yet.
    async retry(auth: SubsonicAuth, id: string): Promise<ImportSummary> {
      await ready
      const job = owned(auth.username, id)
      if (job.finishedAt === undefined) throw new ImportError(409, 'This import is still running')
      const failed = job.entries.filter((entry) => entry.state === 'failed')
      if (failed.length === 0) throw new ImportError(400, 'Every song is already in the playlist')
      // The playlist may have been deleted in the meantime; a missing playlist would make every update fail.
      await navidrome.getPlaylist(auth, job.playlistId).catch(() => {
        throw new ImportError(404, 'The playlist for this import was deleted')
      })
      for (const entry of failed) Object.assign(entry, { state: 'matching', reason: undefined, attempts: 0 })
      void run(job, auth, failed, ATTEMPTS_PER_RUN)
      return summarize(job)
    },

    async failures(username: string, id: string): Promise<FailedSong[]> {
      await ready
      return owned(username, id)
        .entries.filter((entry) => entry.state === 'failed')
        .map((entry) => ({ title: entry.track.title, artists: entry.track.artists, reason: entry.reason ?? 'Unknown' }))
    },

    async list(username: string): Promise<ImportSummary[]> {
      await ready
      prune()
      return [...imports.values()]
        .filter((job) => job.owner === username)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(summarize)
    },
  }
}

export type PlaylistImporter = ReturnType<typeof createPlaylistImporter>
