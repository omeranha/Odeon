import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInvite, USERNAME_PATTERN } from './accountRoutes.ts'
import { accountsReady } from './accounts.ts'
import { INTERNAL_TOKEN_PATH } from './internalTokenPath.ts'

// Loopback alone isn't enough: in development the Vite proxy also connects from 127.0.0.1 on behalf of any visitor.
const token = randomBytes(32).toString('base64url')

export function writeInternalToken() {
  mkdirSync(dirname(INTERNAL_TOKEN_PATH), { recursive: true })
  writeFileSync(INTERNAL_TOKEN_PATH, token, { mode: 0o600 })
}

function isLoopbackSocket(address: string | undefined) {
  return address === '::1' || Boolean(address?.replace(/^::ffff:/, '').startsWith('127.'))
}

function tokenMatches(candidate: string | undefined) {
  const given = Buffer.from(candidate ?? '')
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function internalRoutes() {
  const app = new Hono()

  app.use('*', async (c, next) => {
    let address: string | undefined
    try {
      address = getConnInfo(c).remote.address
    } catch {
      address = undefined
    }
    if (!isLoopbackSocket(address) || !tokenMatches(c.req.header('x-internal-token'))) return c.text('Not found', 404)
    await next()
  })

  // Bootstraps the first sign-in: only administrators can be invited from the command line.
  app.post('/invites', async (c) => {
    await accountsReady
    const { username } = ((await c.req.json().catch(() => ({}))) ?? {}) as { username?: unknown }
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return c.json({ error: 'Invalid username' }, 400)
    const result = await createInvite(username, 'command line', true)
    return 'error' in result ? c.json(result, 400) : c.json(result, 201)
  })

  return app
}
