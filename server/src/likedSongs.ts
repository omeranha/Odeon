import { Hono, type Context } from 'hono'
import { join } from 'node:path'
import { requestAuth, requireNavidromeUser } from './auth.ts'
import { config } from './config.ts'
import { createJsonStore } from './jsonStore.ts'
import type { SubsonicAuth } from './navidrome.ts'
import { cleanSong, type RemoteSong } from './remote.ts'

// Songs from YouTube Music a user liked without adding them to the library. Songs already in Navidrome are starred there.

interface LikedSong {
  song: RemoteSong
  at: number
}

const MAX_LIKED = 5000

const store = createJsonStore<{ users: Record<string, LikedSong[]> }>(config.dataDir ? join(config.dataDir, 'liked-songs.json') : undefined, { users: {} })

function likesOf(c: Context): LikedSong[] {
  const key = (requestAuth(c) as SubsonicAuth).username.toLowerCase()
  const users = store.get().users
  users[key] ??= []
  return users[key]
}

export async function renameLikedSongs(oldName: string, newName: string) {
  await store.ready
  store.update((data) => {
    const from = oldName.toLowerCase()
    if (from === newName.toLowerCase() || !data.users[from]) return
    data.users[newName.toLowerCase()] = data.users[from]
    delete data.users[from]
  })
}
export function likedSongsRoutes() {
  const app = new Hono()

  app.use('*', async (_c, next) => {
    await store.ready
    await next()
  })
  app.use('*', requireNavidromeUser)

  app.get('/', (c) => c.json(likesOf(c)))

  app.post('/', async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { song?: unknown }
    const song = cleanSong(body.song)
    if (!song?.external) return c.json({ error: 'Only songs from YouTube Music can be liked this way' }, 400)
    const key = (requestAuth(c) as SubsonicAuth).username.toLowerCase()
    const likes = likesOf(c)
    if (likes.some((entry) => entry.song.id === song.id)) return c.body(null, 204)
    store.update((data) => {
      data.users[key] = [{ song, at: Date.now() }, ...likes].slice(0, MAX_LIKED)
    })
    return c.body(null, 204)
  })

  app.delete('/:id', (c) => {
    const key = (requestAuth(c) as SubsonicAuth).username.toLowerCase()
    const id = c.req.param('id')
    store.update((data) => {
      data.users[key] = likesOf(c).filter((entry) => entry.song.id !== id)
    })
    return c.body(null, 204)
  })

  return app
}
