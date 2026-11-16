import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from '@simplewebauthn/server'
import { Hono, type Context } from 'hono'
import { accounts, accountsReady, invites, webauthnChallenges, type Invite } from './accounts.ts'
import { renameActivity } from './activity.ts'
import { forgetVerifiedLogins, requestAuth, requireNavidromeAdmin, requireNavidromeUser } from './auth.ts'
import { config } from './config.ts'
import { renameLikedSongs } from './likedSongs.ts'
import { createUser, listUsers, renameUser, sessionFor, userExists } from './navidromeAuth.ts'
import type { SubsonicAuth } from './navidrome.ts'
import { renameRemoteSession } from './remote.ts'
import { activeBans, clientIp, rateLimited, recentSecurityEvents, recordFailedAuth, retryAfterSeconds, unban } from './security.ts'

const WINDOW = 15 * 60_000
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const USERNAME_PATTERN = /^[\p{L}\p{N}._@-]{1,64}$/u
const { rpId, rpName, origins } = config.webauthn

function tooMany(c: Context) {
  return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429, { 'Retry-After': retryAfterSeconds(WINDOW) })
}

async function body<T>(c: Context): Promise<Partial<T>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>
}

function deviceLabel(name: unknown): string {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Passkey'
}

// Hands out a fresh Navidrome login for the account, refusing if the Navidrome user was deleted or replaced.
async function signIn(c: Context, username: string, navidromeId: string) {
  const session = await sessionFor(username)
  if (!session || session.id !== navidromeId) {
    recordFailedAuth(clientIp(c), `sign-in for "${username}" refused: Navidrome user missing or replaced`)
    return c.json({ error: 'This account no longer exists on the music server. Ask the administrator for a new invite.' }, 403)
  }
  return c.json(session)
}

function inviteFrom(c: Context): { token: string; invite: Invite } | undefined {
  const token = c.req.param('token') ?? ''
  const invite = INVITE_TOKEN_PATTERN.test(token) ? invites.find(token) : undefined
  return invite ? { token, invite } : undefined
}

export async function createInvite(username: string, createdBy: string, adminOnly = false): Promise<{ link: string; expiresAt: number; username: string } | { error: string }> {
  if (!(await userExists(username))) return { error: `There is no Navidrome user called "${username}". Create it in Navidrome first.` }
  const session = await sessionFor(username)
  if (!session) return { error: `There is no Navidrome user called "${username}".` }
  if (adminOnly && !session.isAdmin) return { error: `"${session.username}" is not a Navidrome administrator. Invite other users from Settings in the app.` }
  const existing = accounts.get(session.username)
  // A Navidrome user deleted and re-created under the same name is a different person: start them from scratch.
  if (existing && existing.navidromeId !== session.id) accounts.removeAccess(session.username)
  const { token, expiresAt } = invites.create({ username: session.username, navidromeId: session.id, createdBy })
  return { link: `${origins[0]}/invite/${token}`, expiresAt, username: session.username }
}

// Navidrome only lets an administrator rename users. The requester is used if they are one, else the first administrator with an account here.
async function findAdministrator(requester: string): Promise<string | undefined> {
  for (const candidate of new Set([requester, ...accounts.all().map((account) => account.username)])) {
    const session = await sessionFor(candidate).catch(() => undefined)
    if (session?.isAdmin) return session.username
  }
  return undefined
}
export function accountRoutes() {
  const app = new Hono()

  app.use('*', async (_c, next) => {
    await accountsReady
    await next()
  })

  app.post('/auth/passkey/options', async (c) => {
    if (rateLimited(`passkey-options:${clientIp(c)}`, 30, WINDOW)) return tooMany(c)
    const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required' })
    return c.json({ challengeId: webauthnChallenges.save(options.challenge, 'login'), options })
  })

  app.post('/auth/passkey/verify', async (c) => {
    const ip = clientIp(c)
    if (rateLimited(`passkey-verify:${ip}`, 20, WINDOW)) return tooMany(c)
    const { challengeId, response } = await body<{ challengeId: string; response: AuthenticationResponseJSON }>(c)
    const challenge = typeof challengeId === 'string' ? webauthnChallenges.take(challengeId, 'login') : undefined
    const found = response && typeof response.id === 'string' ? accounts.findByCredential(response.id) : undefined
    if (!challenge || !response || !found) {
      recordFailedAuth(ip, 'unknown passkey or expired challenge')
      return c.json({ error: "This passkey isn't registered here. Ask the administrator for an invite link." }, 401)
    }
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: { id: found.passkey.id, publicKey: Buffer.from(found.passkey.publicKey, 'base64url'), counter: found.passkey.counter, transports: found.passkey.transports },
      })
      if (!result.verified) throw new Error('not verified')
      accounts.touchPasskey(found.account.username, found.passkey.id, result.authenticationInfo.newCounter)
    } catch (error) {
      recordFailedAuth(ip, `passkey verification failed for "${found.account.username}": ${error instanceof Error ? error.message : 'error'}`)
      return c.json({ error: "The passkey couldn't be verified" }, 401)
    }
    return signIn(c, found.account.username, found.account.navidromeId)
  })

  // Invite links: GET shows who it's for, then the browser creates a passkey and the account is ready.
  app.get('/invites/:token', (c) => {
    const ip = clientIp(c)
    if (rateLimited(`invite:${ip}`, 30, WINDOW)) return tooMany(c)
    const found = inviteFrom(c)
    if (!found) {
      recordFailedAuth(ip, 'invalid or expired invite link')
      return c.json({ error: 'This invite link is invalid or has expired. Ask the administrator for a new one.' }, 404)
    }
    return c.json({ username: found.invite.username, expiresAt: found.invite.expiresAt, existingAccount: Boolean(accounts.get(found.invite.username)) })
  })

  app.post('/invites/:token/options', async (c) => {
    if (rateLimited(`invite:${clientIp(c)}`, 30, WINDOW)) return tooMany(c)
    const found = inviteFrom(c)
    if (!found) return c.json({ error: 'This invite link is invalid or has expired.' }, 404)
    const account = accounts.get(found.invite.username)
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: found.invite.username,
      userID: Buffer.from(accounts.webauthnUserIdFor(found.invite.username), 'base64url'),
      attestationType: 'none',
      excludeCredentials: (account?.passkeys ?? []).map((passkey) => ({ id: passkey.id, transports: passkey.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    return c.json({ challengeId: webauthnChallenges.save(options.challenge, `invite:${found.token}`), options })
  })

  app.post('/invites/:token', async (c) => {
    const ip = clientIp(c)
    if (rateLimited(`invite:${ip}`, 30, WINDOW)) return tooMany(c)
    const found = inviteFrom(c)
    if (!found) return c.json({ error: 'This invite link is invalid or has expired.' }, 404)
    const { challengeId, response, name } = await body<{ challengeId: string; response: RegistrationResponseJSON; name: string }>(c)
    const challenge = typeof challengeId === 'string' ? webauthnChallenges.take(challengeId, `invite:${found.token}`) : undefined
    if (!challenge || !response) return c.json({ error: 'The request expired. Try again.' }, 400)
    try {
      const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true })
      if (!result.verified) throw new Error('not verified')
      const { credential } = result.registrationInfo
      const webauthnUserId = accounts.webauthnUserIdFor(found.invite.username)
      accounts.addPasskey(found.invite, webauthnUserId, { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports, name: deviceLabel(name), createdAt: Date.now() })
      invites.consume(found.token)
    } catch (error) {
      recordFailedAuth(ip, `invite passkey registration failed: ${error instanceof Error ? error.message : 'error'}`)
      return c.json({ error: "The passkey couldn't be saved. Try again." }, 400)
    }
    return signIn(c, found.invite.username, found.invite.navidromeId)
  })

  const account = new Hono()
  account.use('*', requireNavidromeUser)

  account.get('/', (c) => {
    const current = accounts.get((requestAuth(c) as SubsonicAuth).username)
    return c.json({ passkeys: (current?.passkeys ?? []).map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })) })
  })

  account.post('/passkeys/options', async (c) => {
    const auth = requestAuth(c) as SubsonicAuth
    const current = accounts.get(auth.username)
    if (!current) return c.json({ error: 'Join from an invite link first' }, 404)
    if (rateLimited(`passkey-register:${auth.username.toLowerCase()}`, 10, WINDOW)) return tooMany(c)
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: current.username,
      userID: Buffer.from(current.webauthnUserId, 'base64url'),
      attestationType: 'none',
      excludeCredentials: current.passkeys.map((passkey) => ({ id: passkey.id, transports: passkey.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    return c.json({ challengeId: webauthnChallenges.save(options.challenge, `add:${current.username.toLowerCase()}`), options })
  })

  account.post('/passkeys', async (c) => {
    const auth = requestAuth(c) as SubsonicAuth
    const current = accounts.get(auth.username)
    const { challengeId, response, name } = await body<{ challengeId: string; response: RegistrationResponseJSON; name: string }>(c)
    const challenge = current && typeof challengeId === 'string' ? webauthnChallenges.take(challengeId, `add:${current.username.toLowerCase()}`) : undefined
    if (!current || !challenge || !response) return c.json({ error: 'The request expired. Try again.' }, 400)
    try {
      const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpId, requireUserVerification: true })
      if (!result.verified) throw new Error('not verified')
      const { credential } = result.registrationInfo
      accounts.addPasskey(current, current.webauthnUserId, { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports, name: deviceLabel(name), createdAt: Date.now() })
      return c.json({ added: true }, 201)
    } catch (error) {
      console.warn('Passkey registration failed:', error instanceof Error ? error.message : error)
      return c.json({ error: "The passkey couldn't be saved. Try again." }, 400)
    }
  })

  // Changing the user name renames the Navidrome user, so Subsonic tokens keep working but other devices must sign in again.
  account.put('/username', async (c) => {
    const auth = requestAuth(c) as SubsonicAuth
    if (rateLimited(`rename:${auth.username.toLowerCase()}`, 5, WINDOW)) return tooMany(c)
    const { username } = await body<{ username: string }>(c)
    const next = typeof username === 'string' ? username.trim() : ''
    if (!USERNAME_PATTERN.test(next)) return c.json({ error: 'Use 1 to 64 letters, numbers, dots, dashes, underscores or @ for the username' }, 400)
    const session = await sessionFor(auth.username)
    if (!session) return c.json({ error: 'Your account no longer exists on the music server.' }, 403)
    if (next === session.username) return c.json({ error: 'That is already your username' }, 400)
    const reserved = [config.alexa?.username, config.quality?.autoUser]
    if (reserved.some((name) => name?.toLowerCase() === session.username.toLowerCase())) return c.json({ error: "The server's Alexa or quality upgrade settings use this account by name, so it can't be renamed here." }, 409)
    const sameAccount = next.toLowerCase() === session.username.toLowerCase()
    if (!sameAccount && (await userExists(next))) return c.json({ error: 'That username is taken' }, 409)
    const administrator = await findAdministrator(session.username)
    if (!administrator) return c.json({ error: 'No administrator account was found to make the change' }, 503)
    try {
      if ((await renameUser(administrator, session.id, next)) === 'taken') return c.json({ error: 'That username is taken' }, 409)
    } catch (error) {
      console.error('Renaming a Navidrome user failed:', error instanceof Error ? error.message : error)
      return c.json({ error: "Navidrome couldn't rename the user" }, 502)
    }
    forgetVerifiedLogins(session.username)
    accounts.rename(session.username, next)
    renameRemoteSession(session.username, next)
    await Promise.all([renameActivity(session.username, next), renameLikedSongs(session.username, next)])
    return c.json(await sessionFor(next))
  })
  account.delete('/passkeys/:id', (c) => {
    const result = accounts.removePasskey((requestAuth(c) as SubsonicAuth).username, c.req.param('id'))
    if (result === 'last') return c.json({ error: "This is your only passkey. Add another one first, or you won't be able to sign in." }, 409)
    return result === 'removed' ? c.body(null, 204) : c.json({ error: 'Passkey not found' }, 404)
  })

  const admin = new Hono()
  admin.use('*', requireNavidromeUser)
  admin.use('*', requireNavidromeAdmin)

  admin.get('/users', async (c) => {
    const users = await listUsers((requestAuth(c) as SubsonicAuth).username)
    return c.json(
      users.map((user) => {
        const current = accounts.get(user.username)
        const active = current && current.navidromeId === user.id ? current : undefined
        return { ...user, passkeys: active?.passkeys.length ?? 0, inviteExpiresAt: invites.pendingFor(user.username)?.expiresAt ?? null }
      }),
    )
  })

  admin.post('/invites', async (c) => {
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) return c.json({ error: 'Invalid username' }, 400)
    const result = await createInvite(username, (requestAuth(c) as SubsonicAuth).username)
    return 'error' in result ? c.json(result, 404) : c.json(result, 201)
  })

  // Creates the Navidrome user and returns their first invite link, so the admin never has to open Navidrome.
  admin.post('/users', async (c) => {
    const input = await body<{ username: string; isAdmin: boolean }>(c)
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    if (!USERNAME_PATTERN.test(username)) return c.json({ error: 'Use 1 to 64 letters, numbers, dots, dashes, underscores or @ for the username' }, 400)
    const adminUsername = (requestAuth(c) as SubsonicAuth).username
    if (await userExists(username)) return c.json({ error: `There is already a user called "${username}"` }, 409)
    try {
      await createUser(adminUsername, { username, isAdmin: input.isAdmin === true })
    } catch (error) {
      console.error('Creating a Navidrome user failed:', error instanceof Error ? error.message : error)
      return c.json({ error: "Navidrome couldn't create the user" }, 502)
    }
    const invite = await createInvite(username, adminUsername)
    return 'error' in invite ? c.json(invite, 502) : c.json(invite, 201)
  })

  admin.delete('/users/:username/access', (c) => {
    const username = c.req.param('username')
    if (username.toLowerCase() === (requestAuth(c) as SubsonicAuth).username.toLowerCase()) return c.json({ error: "You can't remove your own access" }, 400)
    return accounts.removeAccess(username) ? c.body(null, 204) : c.json({ error: 'This user has no access to remove' }, 404)
  })

  admin.get('/security', (c) => c.json({ bans: activeBans(), events: recentSecurityEvents() }))
  admin.delete('/bans/:ip', (c) => (unban(c.req.param('ip')) ? c.body(null, 204) : c.json({ error: 'Not banned' }, 404)))

  app.route('/account', account)
  app.route('/admin', admin)
  return app
}
