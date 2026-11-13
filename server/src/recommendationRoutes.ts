import { Hono } from 'hono'
import { requestAuth, requireNavidromeUser } from './auth.ts'
import type { SongFit, SongRef } from './recommendations/fit.ts'

const MAX_SEEDS = 50
const MAX_CANDIDATES = 200

function songRefs(value: unknown, max: number): SongRef[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const refs: SongRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined
    const song = item as Record<string, unknown>
    const text = (field: unknown, limit: number) => (typeof field === 'string' && field.trim() ? field.trim().slice(0, limit) : undefined)
    const id = text(song.id, 200)
    const title = text(song.title, 300)
    if (!id || !title) return undefined
    const year = typeof song.year === 'number' && Number.isInteger(song.year) && song.year > 0 && song.year < 3000 ? song.year : undefined
    refs.push({ id, title, library: text(song.library, 200), artist: text(song.artist, 300), genre: text(song.genre, 100), year })
  }
  return refs
}

export function recommendationRoutes(fit: SongFit) {
  const app = new Hono()
  app.use('*', requireNavidromeUser)

  app.post('/fit', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { seeds?: unknown; candidates?: unknown; budgetMs?: unknown }
    const seeds = songRefs(body.seeds, MAX_SEEDS)
    const candidates = songRefs(body.candidates, MAX_CANDIDATES)
    if (!seeds || !candidates) return c.json({ error: 'Invalid songs' }, 400)
    const budget = typeof body.budgetMs === 'number' && body.budgetMs > 0 ? Math.min(body.budgetMs, 30_000) : undefined
    return c.json({ keep: await fit.fit(requestAuth(c)!, seeds, candidates, budget) })
  })

  return app
}
