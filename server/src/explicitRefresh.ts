import { ADMIN_LOGIN_HINT, DowntifyError, type DowntifyClient } from './downtify.ts'
import { navidrome, type SubsonicAuth } from './navidrome.ts'

type Phase = 'idle' | 'scanning' | 'scanned' | 'replacing' | 'done'

export interface ExplicitCandidate {
  file: string
  title: string
  artist: string
  videoId: string
}

export interface ReplaceFailure {
  title: string
  artist: string
  reason: string
}

export interface ExplicitRefreshStatus {
  phase: Phase
  checked: number
  total: number
  found: ExplicitCandidate[]
  replace: { total: number; done: number; failed: ReplaceFailure[] }
  error?: string
}

// Replacing re-encodes YouTube's lossy audio into the file's format, so lossless files are left alone.
const LOSSY_CODECS = new Set(['mp3', 'aac', 'opus', 'vorbis'])
const SEARCH_CONCURRENCY = 3
const POLL_INTERVAL_MS = 5_000
const MISSING_JOB_WINDOW_MS = 10 * 60_000
const REPLACE_TIMEOUT_MS = 3 * 60 * 60_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function reasonFor(error: unknown): string {
  if (error instanceof DowntifyError && (error.status === 401 || error.status === 403)) return ADMIN_LOGIN_HINT
  return error instanceof Error ? error.message : 'Downtify request failed'
}

function idle(): ExplicitRefreshStatus {
  return { phase: 'idle', checked: 0, total: 0, found: [], replace: { total: 0, done: 0, failed: [] } }
}

// Finds library songs whose file isn't marked explicit although YouTube Music has an explicit version of them, and
// has Downtify swap in that version's audio, which also writes the explicit tag. One run at a time, kept in memory.
export function createExplicitRefresh(downtify: DowntifyClient) {
  let status = idle()
  let cancelled = false

  async function scan() {
    try {
      const tracks = (await downtify.libraryTracks()).filter((track) => !track.explicit && LOSSY_CODECS.has(track.codec))
      status.total = tracks.length
      let next = 0
      await Promise.all(
        Array.from({ length: SEARCH_CONCURRENCY }, async () => {
          while (!cancelled && next < tracks.length) {
            const track = tracks[next++]
            const videoId = await downtify.explicitVideoId({ title: track.title, artist: track.artists[0], duration: track.duration, explicit: true }).catch(() => undefined)
            if (videoId) status.found.push({ file: track.file, title: track.title, artist: track.artists.join(', '), videoId })
            status.checked++
          }
        }),
      )
      status.found.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
      status.phase = 'scanned'
    } catch (error) {
      status = { ...idle(), error: reasonFor(error) }
    }
  }

  async function replace(auth: SubsonicAuth, chosen: ExplicitCandidate[]) {
    const failedFiles = new Set<string>()
    const fail = (candidate: ExplicitCandidate, reason: string) => {
      failedFiles.add(candidate.file)
      status.replace.failed.push({ title: candidate.title, artist: candidate.artist, reason })
    }
    const waiting = new Map<string, ExplicitCandidate>()
    for (const candidate of chosen) {
      try {
        await downtify.replaceAudio(candidate.file, candidate.videoId)
        waiting.set(`replace:${candidate.file}`, candidate)
      } catch (error) {
        // 409: Downtify is already replacing this file, so its job is followed like a new one.
        if (error instanceof DowntifyError && error.status === 409) waiting.set(`replace:${candidate.file}`, candidate)
        else fail(candidate, reasonFor(error))
      }
    }

    const startedAt = Date.now()
    while (waiting.size > 0 && Date.now() - startedAt < REPLACE_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      const jobs = new Map((await downtify.queue(true).catch(() => [])).map((job) => [job.id, job]))
      for (const [id, candidate] of waiting) {
        const job = jobs.get(id)
        if (job?.status === 'done') {
          status.replace.done++
          waiting.delete(id)
        } else if (job?.status === 'error') {
          fail(candidate, job.message ?? 'Replacing failed')
          waiting.delete(id)
        } else if (!job && Date.now() - startedAt > MISSING_JOB_WINDOW_MS) {
          fail(candidate, "The job disappeared from Downtify's queue")
          waiting.delete(id)
        }
      }
    }
    for (const candidate of waiting.values()) fail(candidate, 'Timed out')

    const chosenFiles = new Set(chosen.map((candidate) => candidate.file))
    status.found = status.found.filter((candidate) => !chosenFiles.has(candidate.file) || failedFiles.has(candidate.file))
    if (status.replace.done > 0) {
      await navidrome.startFullScan(auth).catch((error: unknown) => {
        status.error = `The songs were replaced, but Navidrome's rescan didn't start: ${error instanceof Error ? error.message : 'unknown error'}. Start a full scan in Navidrome.`
      })
    }
    status.phase = 'done'
  }

  return {
    status(): ExplicitRefreshStatus {
      return structuredClone(status)
    },

    startScan(): boolean {
      if (status.phase === 'scanning' || status.phase === 'replacing') return false
      status = { ...idle(), phase: 'scanning' }
      cancelled = false
      void scan()
      return true
    },

    cancelScan(): void {
      cancelled = true
    },

    // Only files the last scan found can be replaced, so callers can't point Downtify at arbitrary files or videos.
    startReplace(auth: SubsonicAuth, files: string[]): number | 'busy' | 'none' {
      if (status.phase !== 'scanned' && status.phase !== 'done') return 'busy'
      const wanted = new Set(files)
      const chosen = status.found.filter((candidate) => wanted.has(candidate.file))
      if (chosen.length === 0) return 'none'
      status.phase = 'replacing'
      status.error = undefined
      status.replace = { total: chosen.length, done: 0, failed: [] }
      void replace(auth, chosen).catch((error: unknown) => {
        status.error = reasonFor(error)
        status.phase = 'done'
      })
      return chosen.length
    },
  }
}

export type ExplicitRefresh = ReturnType<typeof createExplicitRefresh>
