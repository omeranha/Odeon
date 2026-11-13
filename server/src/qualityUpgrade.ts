import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import type { DowntifyClient, LibraryTrack } from './downtify.ts'
import { compareFingerprints, fingerprintOf } from './fingerprint.ts'
import { normalize, sameRecording, stripTitle, titleFromFilename } from './matching.ts'
import { navidrome, type SubsonicAuth } from './navidrome.ts'
import type { SlskdClient, SlskdFile, SlskdPeer } from './slskd.ts'

export interface UpgradeFound {
  file: string
  title: string
  artist: string
  peer: string
  remoteFile: string
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

interface Staged extends UpgradeFound {
  stagedPath: string
}

interface Store {
  upgraded: Record<string, { at: number; peer: string }>
  checked: Record<string, number>
}

export interface UpgradeOptions {
  libraryDir: string
  backupDir: string
  storePath: string
  aacBitrate: string
  autoEveryMs: number
  getAdminAuth: () => Promise<SubsonicAuth | undefined>
}

const DURATION_TOLERANCE_SECONDS = 2
const CANDIDATES_PER_SONG = 3
const MAX_FRAME_GAP = 10
const MIN_SIMILARITY = 0.85
const MAX_WEAK_SHARE = 0.1
// A censored word shows up as a short stretch that doesn't match; one stray stretch is tolerated, a second is not.
const MAX_BAD_SEGMENTS = 1
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 20
const FIRST_AUTO_RUN_DELAY_MS = 2 * 60 * 1000

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(binary, args, { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim().split('\n').pop() || error.message))
      else resolvePromise()
    })
  })
}

export function pickCandidates(peers: SlskdPeer[], track: { title: string; artist: string; duration: number }): { peer: string; file: SlskdFile }[] {
  const artist = normalize(track.artist)
  const matches: { peer: SlskdPeer; file: SlskdFile }[] = []
  for (const peer of peers) {
    const file = peer.files.find((candidate) => {
      if (!/\.flac$/i.test(candidate.filename) || candidate.length === undefined) return false
      if (Math.abs(candidate.length - track.duration) > DURATION_TOLERANCE_SECONDS) return false
      if (artist && !normalize(candidate.filename).includes(artist)) return false
      return sameRecording(titleFromFilename(candidate.filename, track.artist), track.title)
    })
    if (file) matches.push({ peer, file })
  }
  const score = (peer: SlskdPeer) => (peer.hasFreeUploadSlot ? 1_000_000 : 0) + Math.min(peer.uploadSpeed, 5_000_000) / 10 - peer.queueLength * 1000
  return matches
    .sort((a, b) => score(b.peer) - score(a.peer))
    .slice(0, CANDIDATES_PER_SONG)
    .map(({ peer, file }) => ({ peer: peer.username, file }))
}

export function createQualityUpgrade(downtify: DowntifyClient, slskd: SlskdClient, options: UpgradeOptions) {
  const libraryRoot = resolve(options.libraryDir)
  let store: Store = { upgraded: {}, checked: {} }
  let loaded = false
  let staged: Staged[] = []
  let cancelled = false
  const status: UpgradeStatus = { phase: 'idle', checked: 0, total: 0, found: [], apply: { total: 0, done: 0, failed: [] }, upgradedEver: 0, auto: { everyMinutes: Math.round(options.autoEveryMs / 60_000) } }

  async function load() {
    if (loaded) return
    loaded = true
    store = await readFile(options.storePath, 'utf8').then((text) => ({ upgraded: {}, checked: {}, ...(JSON.parse(text) as Partial<Store>) }), () => store)
    status.upgradedEver = Object.keys(store.upgraded).length
  }

  async function save() {
    await mkdir(dirname(options.storePath), { recursive: true })
    await writeFile(`${options.storePath}.tmp`, JSON.stringify(store))
    await rename(`${options.storePath}.tmp`, options.storePath)
    status.upgradedEver = Object.keys(store.upgraded).length
  }

  function libraryPath(file: string): string | undefined {
    const path = resolve(libraryRoot, file)
    return path.startsWith(libraryRoot + sep) ? path : undefined
  }

  async function verify(track: LibraryTrack, stagedPath: string): Promise<number | undefined> {
    const current = libraryPath(track.file)
    if (!current) return undefined
    const [a, b] = await Promise.all([fingerprintOf(current), fingerprintOf(stagedPath)])
    if (Math.abs(a.length - b.length) > MAX_FRAME_GAP) return undefined
    const comparison = compareFingerprints(a, b)
    const weakShare = comparison.windows === 0 ? 1 : comparison.weakWindows / comparison.windows
    return comparison.similarity >= MIN_SIMILARITY && weakShare <= MAX_WEAK_SHARE && comparison.badSegments <= MAX_BAD_SEGMENTS ? comparison.similarity : undefined
  }

  async function checkSong(track: LibraryTrack): Promise<Staged | undefined> {
    const artist = track.artists[0] ?? ''
    const peers = await slskd.search(`${artist} ${stripTitle(track.title)}`.trim())
    const candidates = pickCandidates(peers, { title: track.title, artist, duration: track.duration ?? 0 })
    for (const { peer, file } of candidates) {
      if (cancelled) return undefined
      let stagedPath: string | undefined
      try {
        stagedPath = await slskd.download(peer, file, { timeoutMs: 180_000, queuedTimeoutMs: 45_000 })
        const similarity = await verify(track, stagedPath)
        if (similarity !== undefined) return { file: track.file, title: track.title, artist: track.artists.join(', '), peer, remoteFile: file.filename, sizeBytes: file.size, similarity, stagedPath }
      } catch {
        // The next candidate is tried.
      }
      if (stagedPath) await rm(stagedPath, { force: true })
      await slskd.forget(peer, file.filename)
    }
    return undefined
  }

  async function scan(limit: number) {
    try {
      await load()
      const tracks = (await downtify.libraryTracks())
        .filter((track) => /\.m4a$/i.test(track.file) && track.codec === 'aac' && track.duration && !store.upgraded[track.file] && Date.now() - (store.checked[track.file] ?? 0) > RECHECK_MS)
        .sort((a, b) => (store.checked[a.file] ?? 0) - (store.checked[b.file] ?? 0))
        .slice(0, limit)
      status.total = tracks.length
      for (const track of tracks) {
        if (cancelled) break
        status.current = `${track.artists[0] ?? ''} - ${track.title}`
        const result = await checkSong(track).catch(() => undefined)
        store.checked[track.file] = Date.now()
        if (result) {
          staged.push(result)
          const { stagedPath: _stagedPath, ...visible } = result
          status.found.push(visible)
        }
        status.checked++
        await save()
      }
      status.phase = 'scanned'
    } catch (error) {
      status.error = error instanceof Error ? error.message : 'The check failed'
      status.phase = 'scanned'
    } finally {
      status.current = undefined
    }
  }

  async function discardStaged(items: Staged[]) {
    for (const item of items) {
      await rm(item.stagedPath, { force: true })
      await slskd.forget(item.peer, item.remoteFile)
    }
  }

  async function upgradeOne(item: Staged) {
    const target = libraryPath(item.file)
    if (!target) throw new Error('The file is outside the library')
    await stat(target)
    const backup = join(options.backupDir, item.file)
    await mkdir(dirname(backup), { recursive: true })
    await copyFile(target, backup)
    const temporary = join(dirname(target), `.upgrade-${randomBytes(4).toString('hex')}.tmp`)
    try {
      // Audio from the lossless copy; tags, lyrics and cover art from the file being replaced, so nothing else changes.
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', item.stagedPath, '-i', target, '-map', '0:a:0', '-map', '1:v?', '-map_metadata', '1', '-c:a', 'aac', '-b:a', options.aacBitrate, '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-f', 'ipod', temporary])
      const info = await stat(temporary)
      if (info.size < 100_000) throw new Error('The converted file is too small')
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
    store.upgraded[item.file] = { at: Date.now(), peer: item.peer }
  }

  async function apply(auth: SubsonicAuth | undefined, files: string[]) {
    const wanted = new Set(files)
    const chosen = staged.filter((item) => wanted.has(item.file))
    status.apply = { total: chosen.length, done: 0, failed: [] }
    for (const item of chosen) {
      try {
        await upgradeOne(item)
        status.apply.done++
      } catch (error) {
        status.apply.failed.push({ title: item.title, artist: item.artist, reason: error instanceof Error ? error.message : 'The conversion failed' })
      }
    }
    await discardStaged(chosen)
    staged = staged.filter((item) => !wanted.has(item.file))
    status.found = status.found.filter((item) => !wanted.has(item.file))
    await save()
    if (status.apply.done > 0 && auth) await navidrome.startFullScan(auth).catch(() => undefined)
    status.phase = 'done'
  }

  async function runAutomatically() {
    await load()
    if (status.phase === 'scanning' || status.phase === 'applying') return
    cancelled = false
    status.auto.lastRunAt = Date.now()
    Object.assign(status, { phase: 'scanning', checked: 0, total: 0, error: undefined, apply: { total: 0, done: 0, failed: [] } })
    await scan(DEFAULT_LIMIT)
    if (cancelled || staged.length === 0) return
    status.phase = 'applying'
    const auth = await options.getAdminAuth().catch(() => undefined)
    await apply(auth, staged.map((item) => item.file))
  }

  return {
    start() {
      if (options.autoEveryMs <= 0) return
      const tick = () => void runAutomatically().catch((error) => console.warn(`Automatic quality upgrade failed: ${error instanceof Error ? error.message : error}`))
      setTimeout(() => {
        tick()
        setInterval(tick, options.autoEveryMs).unref()
      }, Math.min(FIRST_AUTO_RUN_DELAY_MS, options.autoEveryMs)).unref()
    },

    async status(): Promise<UpgradeStatus> {
      await load()
      return status
    },

    startScan(limit = DEFAULT_LIMIT): boolean {
      if (status.phase === 'scanning' || status.phase === 'applying') return false
      cancelled = false
      void discardStaged(staged)
      staged = []
      Object.assign(status, { phase: 'scanning', checked: 0, total: 0, found: [], error: undefined, apply: { total: 0, done: 0, failed: [] } })
      void scan(Math.min(100, Math.max(1, limit)))
      return true
    },

    cancel() {
      cancelled = true
    },

    startApply(auth: SubsonicAuth, files: string[]): 'started' | 'busy' | 'none' {
      if (status.phase === 'scanning' || status.phase === 'applying') return 'busy'
      if (!staged.some((item) => files.includes(item.file))) return 'none'
      status.phase = 'applying'
      void apply(auth, files)
      return 'started'
    },

    async discard() {
      await discardStaged(staged)
      staged = []
      status.found = []
      status.phase = 'idle'
    },
  }
}

export type QualityUpgrade = ReturnType<typeof createQualityUpgrade>
