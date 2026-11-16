import { Hono, type Context } from 'hono'
import { join } from 'node:path'
import { requestAuth, requireNavidromeUser } from './auth.ts'
import { config } from './config.ts'
import { createJsonStore } from './jsonStore.ts'
import type { SubsonicAuth } from './navidrome.ts'
import { cleanSong, type RemoteSong } from './remote.ts'

interface Play {
  song: RemoteSong
  at: number
}

interface Search {
  query: string
  at: number
}

interface UserActivity {
  plays: Play[]
  searches: Search[]
  // Seconds of playback per month, keyed "YYYY-MM".
  listenedSeconds: Record<string, number>
}

const MAX_PLAYS = 1000
const DEFAULT_PLAYS = 100
const MAX_SEARCHES = 50
const MAX_QUERY_LENGTH = 100
const MAX_REPORT_SECONDS = 600
const DUPLICATE_PLAY_MS = 20_000
const REFINED_SEARCH_MS = 60_000

const store = createJsonStore<{ users: Record<string, UserActivity> }>(config.dataDir ? join(config.dataDir, 'activity.json') : undefined, { users: {} })

function activityOf(c: Context): UserActivity {
  const key = (requestAuth(c) as SubsonicAuth).username.toLowerCase()
  const users = store.get().users
  users[key] ??= { plays: [], searches: [], listenedSeconds: {} }
  return users[key]
}

function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function cleanQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const query = value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  return query.length >= 2 ? query : undefined
}

export function activityRoutes() {
  const app = new Hono()

  app.use('*', async (_c, next) => {
    await store.ready
    await next()
  })
  app.use('*', requireNavidromeUser)

  app.get('/plays', (c) => {
    const requested = Number(c.req.query('limit'))
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_PLAYS) : DEFAULT_PLAYS
    return c.json(activityOf(c).plays.slice(0, limit))
  })

  app.post('/plays', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { song?: unknown }
    const song = cleanSong(body.song)
    if (!song) return c.json({ error: 'Invalid song' }, 400)
    const activity = activityOf(c)
    const now = Date.now()
    if (activity.plays[0]?.song.id === song.id && now - activity.plays[0].at < DUPLICATE_PLAY_MS) return c.body(null, 204)
    store.update(() => {
      activity.plays.unshift({ song, at: now })
      activity.plays.length = Math.min(activity.plays.length, MAX_PLAYS)
    })
    return c.body(null, 204)
  })

  app.delete('/plays', (c) => {
    const activity = activityOf(c)
    store.update(() => {
      activity.plays = []
    })
    return c.body(null, 204)
  })

  app.get('/searches', (c) => c.json(activityOf(c).searches))

  app.post('/searches', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { query?: unknown }
    const query = cleanQuery(body.query)
    if (!query) return c.json({ error: 'Invalid search' }, 400)
    const activity = activityOf(c)
    const now = Date.now()
    const lowered = query.toLowerCase()
    store.update(() => {
      // Typing "daft" and pausing, then finishing "daft punk", should leave one entry.
      const latest = activity.searches[0]
      const refinesLatest = latest && now - latest.at < REFINED_SEARCH_MS && lowered.startsWith(latest.query.toLowerCase())
      activity.searches = [{ query, at: now }, ...activity.searches.slice(refinesLatest ? 1 : 0).filter((entry) => entry.query.toLowerCase() !== lowered)].slice(0, MAX_SEARCHES)
    })
    return c.body(null, 204)
  })

  // Without a query, the whole search history is cleared.
  app.delete('/searches', (c) => {
    const activity = activityOf(c)
    const query = c.req.query('query')?.trim().toLowerCase()
    store.update(() => {
      activity.searches = query ? activity.searches.filter((entry) => entry.query.toLowerCase() !== query) : []
    })
    return c.body(null, 204)
  })

  app.get('/usage', (c) => {
    const months = Object.entries(activityOf(c).listenedSeconds)
      .map(([month, seconds]) => ({ month, seconds }))
      .sort((a, b) => b.month.localeCompare(a.month))
    return c.json({ months })
  })

  app.post('/usage', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { seconds?: unknown }
    if (typeof body.seconds !== 'number' || !Number.isFinite(body.seconds) || body.seconds <= 0) return c.json({ error: 'Invalid duration' }, 400)
    const activity = activityOf(c)
    const month = monthOf(new Date())
    store.update(() => {
      activity.listenedSeconds[month] = (activity.listenedSeconds[month] ?? 0) + Math.round(Math.min(body.seconds as number, MAX_REPORT_SECONDS))
    })
    return c.body(null, 204)
  })

  return app
}
