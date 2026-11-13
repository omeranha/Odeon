import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { proxy } from 'hono/proxy'
import { join } from 'node:path'
import { accountRoutes } from './accountRoutes.ts'
import { alexaRoutes, createAlexaParts } from './alexa/routes.ts'
import { config } from './config.ts'
import { createDowntifyClient } from './downtify.ts'
import { deviceLinkRoutes } from './deviceLink.ts'
import { downtifyRoutes } from './downtifyRoutes.ts'
import { createExplicitRefresh } from './explicitRefresh.ts'
import { createInnertube } from './innertube.ts'
import { createQualityUpgrade } from './qualityUpgrade.ts'
import { createSlskdClient } from './slskd.ts'
import { internalRoutes, writeInternalToken } from './internal.ts'
import { lyricsRoutes } from './lyrics.ts'
import { checkTrust, sessionFor } from './navidromeAuth.ts'
import { createPlaylistImporter } from './playlistImport.ts'
import { recommendationRoutes } from './recommendationRoutes.ts'
import { createSongFit } from './recommendations/fit.ts'
import { remoteRoutes } from './remote.ts'
import { clientIp, coolingDown, guard, recordFailedAuth, securityHeaders } from './security.ts'

const app = new Hono()
const downtify = config.downtify ? createDowntifyClient(config.downtify) : null
const importer = downtify ? createPlaylistImporter(downtify, config.dataDir ? join(config.dataDir, 'imports.json') : undefined) : null
const explicitRefresh = downtify ? createExplicitRefresh(downtify) : null
const innertube = downtify && config.directStreaming ? createInnertube() : null
const quality =
  downtify && config.quality
    ? createQualityUpgrade(downtify, createSlskdClient({ url: config.quality.slskdUrl, apiKey: config.quality.slskdApiKey, downloadsDir: config.quality.slskdDir }), {
        libraryDir: config.quality.libraryDir,
        backupDir: join(config.dataDir ?? '/tmp', 'upgrade-backup'),
        storePath: join(config.dataDir ?? '/tmp', 'quality-upgrades.json'),
        aacBitrate: '256k',
        autoEveryMs: config.quality.autoMinutes * 60_000,
        getAdminAuth: async () => {
          const session = await sessionFor(config.quality!.autoUser)
          return session ? { username: session.username, token: session.subsonicToken, salt: session.subsonicSalt } : undefined
        },
      })
    : null
const songFit = createSongFit({ storePath: config.dataDir ? join(config.dataDir, 'song-languages.json') : undefined })
const alexa = createAlexaParts(downtify, songFit)

app.get('/healthz', (c) => c.text('ok'))
app.use('*', guard)
app.use('*', securityHeaders)

app.use('/api/*', bodyLimit({ maxSize: 512 * 1024 }))
app.route('/api/downtify', downtifyRoutes(downtify, importer, explicitRefresh, quality, innertube))
app.route('/api/remote', remoteRoutes())
app.route('/api/lyrics', lyricsRoutes())
app.route('/api/recommendations', recommendationRoutes(songFit))
app.route('/api', accountRoutes())
app.route('/api', deviceLinkRoutes())
app.route('/api/alexa', alexaRoutes(alexa))
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// Navidrome trusts Remote-User from this server, so a client sending it could act as anyone.
const STRIPPED_HEADERS = new Set(['host', 'expect', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-connection', 'remote-user', 'x-forwarded-user', 'x-remote-user', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'cf-connecting-ip'])

function forwardHeaders(c: Context): Record<string, string> {
  const url = new URL(c.req.url)
  const headers: Record<string, string> = { 'x-forwarded-host': url.host, 'x-forwarded-proto': c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', ''), 'x-forwarded-for': clientIp(c) }
  c.req.raw.headers.forEach((value, name) => {
    if (!STRIPPED_HEADERS.has(name)) headers[name] = value
  })
  return headers
}

app.all('/auth/*', (c) => c.json({ error: 'Not found' }, 404))
app.route('/internal', internalRoutes())
app.all('/internal/*', (c) => c.text('Not found', 404))

const subsonicError = (code: number, message: string) => ({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } })

// Proxying Navidrome keeps the PWA, Subsonic API and login on one origin, so no CORS setup is needed and the service worker can see every request.
const BINARY_SUBSONIC = /^\/rest\/(stream|download|getCoverArt|getAvatar|hls|getTranscodeStream)(\.view)?$/i

app.all('/rest/*', async (c) => {
  const url = new URL(c.req.url)
  const ip = clientIp(c)
  const subsonicKey = `rest:${url.searchParams.get('u') ?? ''}:${url.searchParams.get('t') ?? ''}:${url.searchParams.get('s') ?? ''}`.slice(0, 400)
  // Odeon only ever sends tokens, so a password here is someone guessing.
  if (url.searchParams.has('p')) {
    recordFailedAuth(ip, `Subsonic password login refused for "${(url.searchParams.get('u') ?? '').slice(0, 64)}"`, `rest-p:${url.searchParams.get('u') ?? ''}:${url.searchParams.get('p') ?? ''}`.slice(0, 400))
    return c.json(subsonicError(42, 'Password authentication is disabled'), 401)
  }
  if (coolingDown(ip) && url.searchParams.has('t')) {
    recordFailedAuth(ip, 'Subsonic request while cooling down', subsonicKey)
    return c.json(subsonicError(0, 'Too many failed attempts. Wait a minute.'), 429, { 'Retry-After': '60' })
  }
  const response = await proxy(`${config.navidromeUrl}${url.pathname}${url.search}`, { raw: c.req.raw, headers: forwardHeaders(c) })
  // Subsonic reports a wrong password with HTTP 200 and error code 40, so error bodies are inspected to catch guessing.
  // Media endpoints are skipped: their failures come back as the same small JSON, but successes are large binaries.
  const type = response.headers.get('content-type') ?? ''
  if (response.ok && /json|xml/.test(type) && !BINARY_SUBSONIC.test(url.pathname)) {
    const text = await response.clone().text()
    if (text.length < 4096 && /"code"\s*:\s*4[01]\b|code="4[01]"/.test(text)) recordFailedAuth(ip, `Subsonic auth failed for "${(url.searchParams.get('u') ?? '').slice(0, 64)}"`, subsonicKey)
  }
  return response
})

if (config.staticDir) {
  const root = config.staticDir
  app.use('/sw.js', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-cache')
  })
  app.use('/assets/*', async (c, next) => {
    await next()
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  app.use('*', serveStatic({ root }))
  // A missing hashed asset must be a 404, not the app page: Cloudflare and browsers would cache the HTML under the asset's name for a year.
  app.get('/assets/*', (c) => c.text('Not found', 404, { 'Cache-Control': 'no-store' }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  writeInternalToken()
  console.log(`Odeon server listening on port ${info.port}`)
  console.log(`Navidrome: ${config.navidromeUrl}`)
  console.log(`Downtify: ${config.downtify ? config.downtify.url : 'not configured'}`)
  console.log(`Quality upgrade: ${quality && config.quality ? `on (slskd), ${config.quality.autoMinutes > 0 ? `automatic every ${config.quality.autoMinutes} min` : 'manual only'}` : 'off'}`)
  quality?.start()
  innertube?.warmUp()
  console.log(`Alexa: ${config.alexa ? `skill ${config.alexa.skillId} plays as ${config.alexa.username}, links at ${config.alexa.publicUrl}` : 'not configured'}`)
  if (config.alexa && !config.alexa.publicUrl.startsWith('https://')) console.warn('Alexa: ALEXA_PUBLIC_URL must be a public https:// address, or Echo devices will refuse to play')
  console.log(`Passkeys: ${config.webauthn.rpId} (${config.webauthn.origins.join(', ')})`)
  console.log(`Trusted proxies: ${config.trustedProxies.join(', ') || 'none'}`)
  void checkTrust().then((status) => console.log(`Navidrome header sign-in: ${status}`))
})
