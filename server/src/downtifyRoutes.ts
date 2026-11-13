import { Hono, type Context } from 'hono'
import { requestAuth, requireNavidromeAdmin, requireNavidromeUser } from './auth.ts'
import { ADMIN_LOGIN_HINT, DowntifyError, YOUTUBE_ID_PATTERN, type DowntifyClient, type VideoLookup } from './downtify.ts'
import type { AudioCodec, Innertube } from './innertube.ts'
import type { QualityUpgrade } from './qualityUpgrade.ts'
import type { ExplicitRefresh } from './explicitRefresh.ts'
import { ImportError, type PlaylistImporter } from './playlistImport.ts'
import { navidrome } from './navidrome.ts'

const MAX_SONGS_PER_REQUEST = 200
const MAX_DELETE_FILES = 2000
const LINK_HOSTS = new Set(['open.spotify.com', 'music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.deezer.com', 'deezer.com', 'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'])

function isSupportedLink(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && LINK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

// The song to stream: a YouTube video id, or a title and artist to find one for. Returns an error message when invalid.
function streamTarget(c: Context): (VideoLookup & { video?: string }) | string {
  const video = c.req.query('video')
  const title = (c.req.query('title') ?? '').trim()
  const artist = (c.req.query('artist') ?? '').trim() || undefined
  const album = (c.req.query('album') ?? '').trim() || undefined
  if (video !== undefined && !YOUTUBE_ID_PATTERN.test(video)) return 'Invalid video id'
  if (!video && (title.length === 0 || title.length > 300 || (artist?.length ?? 0) > 300 || (album?.length ?? 0) > 300)) return 'A title is required'
  return { video, title, artist, album, duration: Number(c.req.query('duration')) || undefined, explicit: c.req.query('explicit') === '1' }
}

// Only the web app asks for direct; the car app and Alexa keep the file Downtify prepares, which older players decode.
function directCodec(c: Context): AudioCodec | null {
  if (c.req.query('direct') !== '1') return null
  return c.req.query('codec') === 'any' ? 'any' : 'aac'
}

function handleError(c: Context, error: unknown) {
  if (error instanceof ImportError) return c.json({ error: error.message }, error.status)
  console.error('Downtify request failed:', error instanceof Error ? error.message : error)
  if (error instanceof DowntifyError && (error.status === 400 || error.status === 404)) return c.json({ error: "That link couldn't be found. Check it and try again." }, 404)
  if (error instanceof DowntifyError && error.status === 429) return c.json({ error: 'Downtify is busy. Try again in a moment.' }, 429)
  return c.json({ error: 'Downtify request failed' }, 502)
}

export function downtifyRoutes(client: DowntifyClient | null, importer: PlaylistImporter | null, refresher: ExplicitRefresh | null, quality: QualityUpgrade | null = null, innertube: Innertube | null = null) {
  const app = new Hono()

  app.get('/status', (c) => c.json({ enabled: client !== null }))

  app.use('*', requireNavidromeUser)
  app.use('*', async (c, next) => {
    if (!client) return c.json({ error: 'Downtify is not configured on this server' }, 503)
    await next()
  })

  app.get('/search', async (c) => {
    const query = (c.req.query('q') ?? '').trim()
    if (query.length < 2 || query.length > 200) return c.json({ error: 'Search text must be between 2 and 200 characters' }, 400)
    try {
      return c.json({ tracks: await client!.search(query) })
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/similar', async (c) => {
    const title = (c.req.query('title') ?? '').trim()
    const artist = (c.req.query('artist') ?? '').trim() || undefined
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20))
    if (title.length === 0 || title.length > 300 || (artist?.length ?? 0) > 300) return c.json({ error: 'A title is required' }, 400)
    try {
      return c.json({ tracks: await client!.similar({ title, artist }, limit) })
    } catch (error) {
      // Downtify answers 502 when YouTube Music doesn't know the song; that just means no suggestions.
      if (error instanceof DowntifyError && (error.status === 404 || error.status === 502)) return c.json({ tracks: [] })
      return handleError(c, error)
    }
  })

  app.get('/resolve', async (c) => {
    const url = (c.req.query('url') ?? '').trim()
    if (url.length > 500 || !isSupportedLink(url)) return c.json({ error: 'Paste a Spotify, YouTube Music, Deezer or SoundCloud link' }, 400)
    try {
      return c.json(await client!.resolve(url))
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.post('/downloads', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { songIds?: unknown }
    const songIds = body.songIds
    if (!Array.isArray(songIds) || songIds.length === 0 || songIds.length > MAX_SONGS_PER_REQUEST || !songIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)) {
      return c.json({ error: 'Invalid download request' }, 400)
    }
    try {
      const result = await client!.enqueue(songIds as string[])
      if (result.queued === 0) return c.json({ error: 'These results expired. Search again and retry.' }, 410)
      return c.json(result, 201)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/queue', async (c) => {
    try {
      return c.json(await client!.queue())
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.delete('/queue/completed', async (c) => {
    try {
      await client!.clearCompleted()
      return c.body(null, 204)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.post('/imports', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown }
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (url.length > 500 || !isSupportedLink(url)) return c.json({ error: 'Paste a Spotify, YouTube Music or Deezer playlist link' }, 400)
    const auth = requestAuth(c)
    if (!auth || !importer) return c.json({ error: 'Not authorized' }, 401)
    try {
      return c.json(await importer.start(auth, url), 201)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/imports', async (c) => {
    const auth = requestAuth(c)
    if (!auth || !importer) return c.json({ error: 'Not authorized' }, 401)
    return c.json(await importer.list(auth.username))
  })

  app.post('/imports/:id/retry', async (c) => {
    const auth = requestAuth(c)
    if (!auth || !importer) return c.json({ error: 'Not authorized' }, 401)
    try {
      return c.json(await importer.retry(auth, c.req.param('id')))
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/imports/:id/failures', async (c) => {
    const auth = requestAuth(c)
    if (!auth || !importer) return c.json({ error: 'Not authorized' }, 401)
    try {
      return c.json(await importer.failures(auth.username, c.req.param('id')))
    } catch (error) {
      return handleError(c, error)
    }
  })

  const explicit = new Hono()
  explicit.use('*', requireNavidromeAdmin)
  explicit.get('/', (c) => c.json(refresher!.status()))
  explicit.post('/scan', (c) => (refresher!.startScan() ? c.json(refresher!.status(), 202) : c.json({ error: 'A check or replacement is already running' }, 409)))
  explicit.post('/cancel', (c) => {
    refresher!.cancelScan()
    return c.body(null, 204)
  })
  explicit.post('/replace', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { files?: unknown }
    const files = body.files
    if (!Array.isArray(files) || files.length === 0 || files.length > 5000 || !files.every((file) => typeof file === 'string' && file.length > 0 && file.length <= 1000)) return c.json({ error: 'Invalid replace request' }, 400)
    const result = refresher!.startReplace(requestAuth(c)!, files as string[])
    if (result === 'busy') return c.json({ error: 'Check the library first, or wait for the current run to finish' }, 409)
    if (result === 'none') return c.json({ error: 'None of these songs are in the last check. Check again.' }, 400)
    return c.json(refresher!.status(), 202)
  })
  app.route('/explicit', explicit)

  const upgrade = new Hono()
  upgrade.use('*', requireNavidromeAdmin)
  upgrade.use('*', async (c, next) => {
    if (!quality) return c.json({ error: 'Quality upgrades are not set up on this server' }, 503)
    await next()
  })
  upgrade.get('/', async (c) => c.json(await quality!.status()))
  upgrade.post('/scan', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { limit?: unknown }
    const limit = typeof body.limit === 'number' ? body.limit : undefined
    return quality!.startScan(limit) ? c.json(await quality!.status(), 202) : c.json({ error: 'A check or conversion is already running' }, 409)
  })
  upgrade.post('/cancel', (c) => {
    quality!.cancel()
    return c.body(null, 204)
  })
  upgrade.post('/discard', async (c) => {
    await quality!.discard()
    return c.body(null, 204)
  })
  upgrade.post('/apply', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { files?: unknown }
    const files = body.files
    if (!Array.isArray(files) || files.length === 0 || files.length > 200 || !files.every((file) => typeof file === 'string' && file.length > 0 && file.length <= 1000)) return c.json({ error: 'Invalid request' }, 400)
    const result = quality!.startApply(requestAuth(c)!, files as string[])
    if (result === 'busy') return c.json({ error: 'Wait for the current run to finish' }, 409)
    if (result === 'none') return c.json({ error: 'None of these songs are in the last check. Check again.' }, 400)
    return c.json(await quality!.status(), 202)
  })
  app.route('/quality', upgrade)

  const library = new Hono()
  library.use('*', requireNavidromeAdmin)
  library.get('/', async (c) => {
    try {
      const tracks = await client!.libraryTracks()
      return c.json(tracks.sort((a, b) => (a.artists[0] ?? '').localeCompare(b.artists[0] ?? '') || a.title.localeCompare(b.title)))
    } catch (error) {
      return handleError(c, error)
    }
  })
  library.post('/delete', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { files?: unknown }
    const files = body.files
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_DELETE_FILES || !files.every((file) => typeof file === 'string' && file.length > 0 && file.length <= 1000)) return c.json({ error: 'Invalid delete request' }, 400)
    try {
      // Only files Downtify itself lists can be deleted, so a client can't point it at arbitrary paths.
      const known = new Set((await client!.libraryTracks()).map((track) => track.file))
      const wanted = [...new Set(files as string[])].filter((file) => known.has(file))
      if (wanted.length === 0) return c.json({ error: 'None of these songs are in the library anymore. Reload the list.' }, 404)
      const result = await client!.deleteFiles(wanted)
      let scanStarted = false
      if (result.deleted > 0) scanStarted = await navidrome.startFullScan(requestAuth(c)!).then(() => true, () => false)
      return c.json({ ...result, scanStarted })
    } catch (error) {
      if (error instanceof DowntifyError && (error.status === 401 || error.status === 403)) return c.json({ error: ADMIN_LOGIN_HINT }, 403)
      return handleError(c, error)
    }
  })
  app.route('/library', library)

  const storage = new Hono()
  storage.use('*', requireNavidromeAdmin)
  storage.get('/', async (c) => {
    const days = [7, 30, 90, 365].includes(Number(c.req.query('days'))) ? Number(c.req.query('days')) : 30
    try {
      return c.json(await client!.storageUsage(days))
    } catch (error) {
      if (error instanceof DowntifyError && (error.status === 401 || error.status === 403)) return c.json({ error: ADMIN_LOGIN_HINT }, 403)
      if (error instanceof DowntifyError && error.status === 404) return c.json({ error: "This version of Downtify doesn't have storage statistics. Update Downtify." }, 404)
      return handleError(c, error)
    }
  })
  storage.get('/scan', async (c) => {
    try {
      return c.json(await client!.storageScan(c.req.query('refresh') === 'true'))
    } catch (error) {
      return handleError(c, error)
    }
  })
  app.route('/storage', storage)

  app.post('/prefetch', async (c) => {
    const target = streamTarget(c)
    if (typeof target === 'string') return c.json({ error: target }, 400)
    try {
      const videoId = target.video ?? (await client!.findVideoId(target))
      if (!videoId) return c.json({ error: 'No playable version found' }, 404)
      const codec = directCodec(c)
      if (codec && innertube) {
        // Looking the stream up is all it takes, so this is cheap enough to do for several songs at once.
        const ready = await innertube.resolve(videoId, codec).then(() => true, () => false)
        if (ready) return c.body(null, 202)
      }
      await client!.prefetch(videoId)
      return c.body(null, 202)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/stream', async (c) => {
    const target = streamTarget(c)
    if (typeof target === 'string') return c.json({ error: target }, 400)
    try {
      const videoId = target.video ?? (await client!.findVideoId(target))
      if (!videoId) return c.json({ error: 'No playable version found' }, 404)
      const codec = directCodec(c)
      if (codec && innertube) {
        try {
          return await innertube.serve(videoId, codec, c.req.header('range'))
        } catch (error) {
          console.warn('Direct stream failed, using Downtify:', error instanceof Error ? error.message : error)
        }
      }
      const upstream = await client!.stream(videoId, target.duration, c.req.header('range'))
      if (!upstream.ok) return c.json({ error: "This song can't be streamed right now" }, upstream.status === 400 ? 400 : 503)
      const headers = new Headers()
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      headers.set('cache-control', 'private, max-age=3600')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      return handleError(c, error)
    }
  })

  return app
}
