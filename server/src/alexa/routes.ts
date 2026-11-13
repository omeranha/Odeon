import { Hono } from 'hono'
import { config } from '../config.ts'
import type { DowntifyClient } from '../downtify.ts'
import type { SubsonicAuth } from '../navidrome.ts'
import { sessionFor } from '../navidromeAuth.ts'
import type { SongFit } from '../recommendations/fit.ts'
import { createAlexaMusic } from './music.ts'
import { createAlexaPlayer, type AlexaPlayer } from './player.ts'
import { createAlexaSkill, type AlexaSkill } from './skill.ts'
import { AlexaVerificationError, createAlexaVerifier, type AlexaVerifier } from './verify.ts'

const SESSION_TTL_MS = 10 * 60_000
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']

function subsonicQuery(auth: SubsonicAuth, params: Record<string, string>): string {
  return new URLSearchParams({ u: auth.username, t: auth.token, s: auth.salt, v: '1.16.1', c: 'odeon-alexa', ...params }).toString()
}

function passThrough(upstream: Response, kind: 'audio/' | 'image/'): Response {
  if (!upstream.ok || !(upstream.headers.get('content-type') ?? '').startsWith(kind)) return new Response('Not available', { status: 502 })
  const headers = new Headers()
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}

// The Echo plays as one Navidrome user, whose login the server gets through Navidrome's header trust like any sign-in.
export function navidromeLoginFor(username: string): () => Promise<SubsonicAuth> {
  let cached: { auth: SubsonicAuth; expires: number } | undefined
  return async () => {
    if (cached && cached.expires > Date.now()) return cached.auth
    const session = await sessionFor(username)
    if (!session) throw new Error(`There is no Navidrome user called "${username}" (ALEXA_USERNAME)`)
    cached = { auth: { username: session.username, token: session.subsonicToken, salt: session.subsonicSalt }, expires: Date.now() + SESSION_TTL_MS }
    return cached.auth
  }
}

export interface AlexaParts {
  verifier: AlexaVerifier
  skill: AlexaSkill
  player: AlexaPlayer
  auth: () => Promise<SubsonicAuth>
  downtify: DowntifyClient | null
}

export function createAlexaParts(downtify: DowntifyClient | null, fit?: SongFit): AlexaParts | null {
  if (!config.alexa) return null
  const auth = navidromeLoginFor(config.alexa.username)
  const player = createAlexaPlayer({ publicUrl: config.alexa.publicUrl, storePath: config.dataDir ? `${config.dataDir}/alexa.json` : undefined })
  const music = createAlexaMusic({ auth, downtify, fit })
  return { verifier: createAlexaVerifier({ skillId: config.alexa.skillId }), skill: createAlexaSkill({ music, player, downtify, auth }), player, auth, downtify }
}

export function alexaRoutes(parts: AlexaParts | null) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (!parts) return c.json({ error: 'Alexa is not configured on this server' }, 404)
    await next()
  })

  // The skill endpoint. Amazon signs every request; anything that fails the check gets a 400, as Amazon requires.
  app.post('/', async (c) => {
    const body = await c.req.text()
    let envelope
    try {
      envelope = await parts!.verifier({ certUrl: c.req.header('signaturecertchainurl'), signature: c.req.header('signature-256') }, body)
    } catch (error) {
      console.warn('Rejected an Alexa request:', error instanceof AlexaVerificationError ? error.message : error)
      return c.json({ error: 'Invalid request' }, 400)
    }
    await parts!.player.ready
    try {
      return c.json(await parts!.skill.handle(envelope))
    } catch (error) {
      console.error('Alexa request failed:', error)
      return c.json({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'Desculpe, não consegui fazer isso agora.' }, shouldEndSession: true } })
    }
  })

  // Echo devices fetch these themselves, without credentials, so the link's signature is the only check.
  app.get('/stream/:link', async (c) => {
    const target = parts!.player.readLink(c.req.param('link'))
    if (!target) return c.text('Not found', 404)
    const range = c.req.header('range')
    try {
      if (target.library) {
        const auth = await parts!.auth()
        const params: Record<string, string> = { id: target.library, format: 'mp3', maxBitRate: '320' }
        if (target.startSeconds) params.timeOffset = String(target.startSeconds)
        const upstream = await fetch(`${config.navidromeUrl}/rest/stream?${subsonicQuery(auth, params)}`, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(120_000) })
        return passThrough(upstream, 'audio/')
      }
      if (!parts!.downtify || !target.title) return c.text('Not found', 404)
      const videoId = target.video ?? (await parts!.downtify.findVideoId({ title: target.title, artist: target.artist?.split(',')[0]?.trim(), duration: target.duration, explicit: target.explicit }))
      if (!videoId) return c.text('Not found', 404)
      return passThrough(await parts!.downtify.stream(videoId, target.duration, range), 'audio/')
    } catch (error) {
      console.error('Alexa stream failed:', error instanceof Error ? error.message : error)
      return c.text('Not available', 502)
    }
  })

  app.get('/cover/:link', async (c) => {
    const target = parts!.player.readLink(c.req.param('link'))
    if (!target?.cover) return c.text('Not found', 404)
    try {
      const auth = await parts!.auth()
      return passThrough(await fetch(`${config.navidromeUrl}/rest/getCoverArt?${subsonicQuery(auth, { id: target.cover, size: '600' })}`, { signal: AbortSignal.timeout(30_000) }), 'image/')
    } catch {
      return c.text('Not available', 502)
    }
  })

  return app
}
