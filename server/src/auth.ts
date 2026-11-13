import type { Context, MiddlewareHandler } from 'hono'
import { config } from './config.ts'
import type { SubsonicAuth } from './navidrome.ts'
import { sessionFor } from './navidromeAuth.ts'
import { clientIp, recordFailedAuth } from './security.ts'

const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 500
const verified = new Map<string, number>()

export type AuthCheck = 'ok' | 'invalid' | 'unreachable'

export async function checkSubsonicAuth(auth: SubsonicAuth): Promise<AuthCheck> {
  const key = `${auth.username}\n${auth.token}\n${auth.salt}`
  const expiresAt = verified.get(key)
  if (expiresAt && expiresAt > Date.now()) return 'ok'

  const url = new URL(`${config.navidromeUrl}/rest/ping`)
  url.search = new URLSearchParams({ u: auth.username, t: auth.token, s: auth.salt, v: '1.16.1', c: 'odeon-server', f: 'json' }).toString()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const body = (await response.json()) as { 'subsonic-response'?: { status?: string } }
    if (body['subsonic-response']?.status !== 'ok') return 'invalid'
  } catch {
    return 'unreachable'
  }

  if (verified.size >= MAX_CACHE_ENTRIES) verified.clear()
  verified.set(key, Date.now() + CACHE_TTL_MS)
  return 'ok'
}

// Every Downtify and account request must carry the caller's Subsonic token, checked against Navidrome, because the
// Downtify token and stored logins live only on this server.
// Audio elements can't send headers, so stream URLs carry the same u/t/s query parameters Subsonic itself uses.
export const requireNavidromeUser: MiddlewareHandler = async (c, next) => {
  const auth = requestAuth(c)
  if (!auth) return c.json({ error: 'Not authorized' }, 401)
  const result = await checkSubsonicAuth(auth)
  if (result === 'unreachable') return c.json({ error: 'The music server is not reachable' }, 503)
  if (result === 'invalid') {
    recordFailedAuth(clientIp(c), `invalid Subsonic token for "${auth.username.slice(0, 64)}"`, `api:${auth.username}:${auth.token}:${auth.salt}`)
    return c.json({ error: 'Not authorized' }, 401)
  }
  await next()
}

// Runs after requireNavidromeUser, which has already verified the caller's token.
export const requireNavidromeAdmin: MiddlewareHandler = async (c, next) => {
  const session = await sessionFor((requestAuth(c) as SubsonicAuth).username).catch(() => undefined)
  if (!session?.isAdmin) return c.json({ error: 'Only administrators can do this' }, 403)
  await next()
}

export function requestAuth(c: Context): SubsonicAuth | null {
  const username = c.req.header('x-subsonic-user') ?? c.req.query('u')
  const token = c.req.header('x-subsonic-token') ?? c.req.query('t')
  const salt = c.req.header('x-subsonic-salt') ?? c.req.query('s')
  return username && token && salt && username.length <= 128 && token.length <= 128 && salt.length <= 64 ? { username, token, salt } : null
}
