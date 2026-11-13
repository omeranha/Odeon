import { randomBytes } from 'node:crypto'
import { config } from './config.ts'

// Navidrome trusts the Remote-User header only from Odeon's address (ND_EXTAUTH_TRUSTEDSOURCES), so these calls
// act as the named user without a password. Clients can never send this header: the proxy strips it.

export interface NavidromeSession {
  id: string
  name: string
  username: string
  isAdmin: boolean
  subsonicToken: string
  subsonicSalt: string
}

export interface NavidromeUser {
  id: string
  username: string
  name: string
  isAdmin: boolean
}

const asUser = (username: string) => ({ 'Remote-User': username })

// Navidrome's app page auto-creates unknown header users, so existence is checked first with an endpoint that doesn't.
export async function userExists(username: string): Promise<boolean> {
  const response = await fetch(`${config.navidromeUrl}/api/keepalive/keepalive`, { headers: asUser(username), signal: AbortSignal.timeout(10_000) })
  return response.ok
}

export async function sessionFor(username: string): Promise<NavidromeSession | undefined> {
  if (!(await userExists(username))) return undefined
  const html = await (await fetch(`${config.navidromeUrl}/app/`, { headers: asUser(username), signal: AbortSignal.timeout(10_000) })).text()
  const literal = html.match(/__APP_CONFIG__\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1]
  if (!literal) throw new Error('Navidrome did not return its app configuration. Is ND_EXTAUTH_TRUSTEDSOURCES set to this server?')
  const auth = (JSON.parse(JSON.parse(literal) as string) as { auth?: NavidromeSession }).auth
  if (!auth?.subsonicToken) throw new Error('Navidrome did not trust this server. Check ND_EXTAUTH_TRUSTEDSOURCES.')
  return { id: auth.id, name: auth.name, username: auth.username, isAdmin: Boolean(auth.isAdmin), subsonicToken: auth.subsonicToken, subsonicSalt: auth.subsonicSalt }
}

export async function listUsers(adminUsername: string): Promise<NavidromeUser[]> {
  const response = await fetch(`${config.navidromeUrl}/api/user?_sort=userName&_order=ASC`, { headers: asUser(adminUsername), signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Navidrome user list failed with HTTP ${response.status}`)
  const users = (await response.json()) as { id: string; userName: string; name: string; isAdmin: boolean }[]
  return users.map((user) => ({ id: user.id, username: user.userName, name: user.name || user.userName, isAdmin: Boolean(user.isAdmin) }))
}

// People sign in with an invite and a passkey, never with this password. Subsonic tokens are derived from it, though,
// so an empty or guessable one would let anyone sign in as the user; it's random and never shown or stored here.
// Navidrome gives a new regular user its default libraries, and an admin all of them.
export async function createUser(adminUsername: string, user: { username: string; name: string; isAdmin: boolean }): Promise<void> {
  const response = await fetch(`${config.navidromeUrl}/api/user`, {
    method: 'POST',
    headers: { ...asUser(adminUsername), 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: user.username, name: user.name, email: '', isAdmin: user.isAdmin, password: randomBytes(32).toString('base64url') }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Navidrome refused to create the user (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}`)
}

// Checks the trust setup once at startup so a misconfiguration shows up in the logs right away.
export async function checkTrust(): Promise<string> {
  try {
    const response = await fetch(`${config.navidromeUrl}/api/keepalive/keepalive`, { headers: asUser('odeon-trust-check-nonexistent'), signal: AbortSignal.timeout(10_000) })
    const html = await (await fetch(`${config.navidromeUrl}/app/`, { signal: AbortSignal.timeout(10_000) })).text()
    if (!html.includes('__APP_CONFIG__')) return 'Navidrome app page not found'
    return response.status === 401 ? 'reachable (header trust is verified on first sign-in)' : `unexpected keepalive status ${response.status}`
  } catch (error) {
    return `unreachable: ${error instanceof Error ? error.message : error}`
  }
}
