import { createHash, randomBytes, randomInt } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { requestAuth, requireNavidromeUser } from './auth.ts'
import { sessionFor, type NavidromeSession } from './navidromeAuth.ts'
import type { SubsonicAuth } from './navidrome.ts'
import { clientIp, rateLimited, recordFailedAuth, retryAfterSeconds } from './security.ts'

// Sign-in for devices that can't use passkeys (old Android): the device shows a code, a signed-in user approves it
// in Settings, and the device's polling picks up that user's session. Modelled on the OAuth device flow (RFC 8628).

const LINK_TTL_MS = 10 * 60_000
const POLL_INTERVAL_S = 3
const MAX_PENDING = 200
const WINDOW = 15 * 60_000
// No 0/O or 1/I, so the code can be read off a small screen without mistakes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

interface PendingLink {
  deviceName: string
  userCode: string
  expiresAt: number
  session?: NavidromeSession
}

const links = new Map<string, PendingLink>()
const byUserCode = new Map<string, string>()

const hash = (deviceCode: string) => createHash('sha256').update(deviceCode).digest('base64url')
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

function newUserCode(): string {
  let code = ''
  do {
    code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  } while (byUserCode.has(code))
  return code
}

function remove(key: string) {
  const link = links.get(key)
  if (link) byUserCode.delete(link.userCode)
  links.delete(key)
}

function pendingByUserCode(code: string): { key: string; link: PendingLink } | undefined {
  const key = byUserCode.get(normalizeCode(code))
  const link = key ? links.get(key) : undefined
  return key && link && link.expiresAt > Date.now() && !link.session ? { key, link } : undefined
}

setInterval(() => {
  const now = Date.now()
  for (const [key, link] of links) if (link.expiresAt < now) remove(key)
}, 60_000).unref()

function tooMany(c: Context) {
  return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429, { 'Retry-After': retryAfterSeconds(WINDOW) })
}

export function deviceLinkRoutes() {
  const app = new Hono()

  app.post('/devices/start', async (c) => {
    if (rateLimited(`device-start:${clientIp(c)}`, 10, WINDOW)) return tooMany(c)
    if (links.size >= MAX_PENDING) return c.json({ error: 'Too many devices are waiting to sign in. Try again in a few minutes.' }, 503)
    const { name } = ((await c.req.json().catch(() => ({}))) ?? {}) as { name?: unknown }
    const deviceName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : 'Device'
    const deviceCode = randomBytes(32).toString('base64url')
    const userCode = newUserCode()
    const expiresAt = Date.now() + LINK_TTL_MS
    links.set(hash(deviceCode), { deviceName, userCode, expiresAt })
    byUserCode.set(userCode, hash(deviceCode))
    return c.json({ deviceCode, userCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}`, expiresAt, interval: POLL_INTERVAL_S }, 201)
  })

  app.post('/devices/poll', async (c) => {
    if (rateLimited(`device-poll:${clientIp(c)}`, 400, WINDOW)) return tooMany(c)
    const { deviceCode } = ((await c.req.json().catch(() => ({}))) ?? {}) as { deviceCode?: unknown }
    const key = typeof deviceCode === 'string' && deviceCode.length === 43 ? hash(deviceCode) : undefined
    const link = key ? links.get(key) : undefined
    if (!key || !link || link.expiresAt < Date.now()) return c.json({ error: 'This code has expired. Start again on the device.' }, 404)
    if (!link.session) return c.json({ status: 'pending' }, 202)
    remove(key)
    return c.json(link.session)
  })

  const approval = new Hono()
  approval.use('*', requireNavidromeUser)

  approval.get('/:code', (c) => {
    const username = (requestAuth(c) as SubsonicAuth).username
    if (rateLimited(`device-link:${username.toLowerCase()}`, 20, WINDOW)) return tooMany(c)
    const found = pendingByUserCode(c.req.param('code'))
    if (!found) {
      recordFailedAuth(clientIp(c), `unknown device code entered by "${username.slice(0, 64)}"`)
      return c.json({ error: "That code doesn't match a device waiting to sign in. Check the code on the device, or start again there." }, 404)
    }
    return c.json({ deviceName: found.link.deviceName, expiresAt: found.link.expiresAt })
  })

  approval.post('/:code', async (c) => {
    const username = (requestAuth(c) as SubsonicAuth).username
    if (rateLimited(`device-link:${username.toLowerCase()}`, 20, WINDOW)) return tooMany(c)
    const found = pendingByUserCode(c.req.param('code'))
    if (!found) return c.json({ error: "That code doesn't match a device waiting to sign in." }, 404)
    const session = await sessionFor(username)
    if (!session) return c.json({ error: 'Your account no longer exists on the music server.' }, 403)
    found.link.session = session
    return c.json({ deviceName: found.link.deviceName, username: session.username })
  })

  app.route('/device-links', approval)
  return app
}
