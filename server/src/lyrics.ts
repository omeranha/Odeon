import { Hono } from 'hono'
import { requireNavidromeUser } from './auth.ts'

export interface LyricLine {
  time: number
  text: string
}

export interface Lyrics {
  synced: LyricLine[] | null
  plain: string | null
}

interface LrclibRecord {
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const LRCLIB = 'https://lrclib.net/api'
const USER_AGENT = 'Odeon (self-hosted music player)'
const CACHE_LIMIT = 500
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_FIELD_LENGTH = 300

export function parseSyncedLyrics(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of text.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue
    const content = row.replace(/\[[^\]]*\]/g, '').trim()
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text: content })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

function toLyrics(record: LrclibRecord | undefined): Lyrics {
  if (!record || record.instrumental) return { synced: null, plain: null }
  const synced = record.syncedLyrics ? parseSyncedLyrics(record.syncedLyrics) : []
  return { synced: synced.length > 0 ? synced : null, plain: record.plainLyrics?.trim() || null }
}

async function lrclib(path: string, params: URLSearchParams): Promise<unknown> {
  const response = await fetch(`${LRCLIB}${path}?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`LRCLIB returned HTTP ${response.status}`)
  return response.json()
}

export interface LyricsQuery {
  title: string
  artist: string
  album?: string
  duration?: number
}

export function createLyricsFinder() {
  const cache = new Map<string, { at: number; lyrics: Lyrics }>()

  return async function find(query: LyricsQuery): Promise<Lyrics> {
    const key = `${query.artist}\n${query.title}\n${query.album ?? ''}\n${Math.round(query.duration ?? 0)}`.toLowerCase()
    const cached = cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.lyrics

    const exact = new URLSearchParams({ track_name: query.title, artist_name: query.artist })
    if (query.album) exact.set('album_name', query.album)
    if (query.duration) exact.set('duration', String(Math.round(query.duration)))
    let record = (await lrclib('/get', exact)) as LrclibRecord | undefined
    if (!record) {
      const results = (await lrclib('/search', new URLSearchParams({ track_name: query.title, artist_name: query.artist }))) as LrclibRecord[] | undefined
      const close = (results ?? []).filter((entry) => !query.duration || !entry.duration || Math.abs(entry.duration - (query.duration ?? 0)) <= 5)
      record = close.find((entry) => entry.syncedLyrics) ?? close[0]
    }
    const lyrics = toLyrics(record)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    cache.set(key, { at: Date.now(), lyrics })
    return lyrics
  }
}

export function lyricsRoutes() {
  const app = new Hono()
  const find = createLyricsFinder()
  app.use('*', requireNavidromeUser)
  app.get('/', async (c) => {
    const title = (c.req.query('title') ?? '').trim()
    const artist = (c.req.query('artist') ?? '').trim()
    const album = (c.req.query('album') ?? '').trim() || undefined
    if (!title || !artist || title.length > MAX_FIELD_LENGTH || artist.length > MAX_FIELD_LENGTH || (album?.length ?? 0) > MAX_FIELD_LENGTH) return c.json({ error: 'A title and artist are required' }, 400)
    try {
      return c.json(await find({ title, artist, album, duration: Number(c.req.query('duration')) || undefined }))
    } catch (error) {
      console.error('Lyrics lookup failed:', error instanceof Error ? error.message : error)
      return c.json({ error: "Lyrics aren't available right now" }, 502)
    }
  })
  return app
}
