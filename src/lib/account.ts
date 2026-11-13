import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import type { SubsonicCredentials } from './subsonic/client'

export interface SignInResult {
  id: string
  name: string
  username: string
  isAdmin: boolean
  subsonicToken: string
  subsonicSalt: string
}

export interface AccountPasskey {
  id: string
  name: string
  createdAt: number
  lastUsedAt?: number
}

export interface InviteInfo {
  username: string
  name: string
  expiresAt: number
  existingAccount: boolean
}

export interface ManagedUser {
  id: string
  username: string
  name: string
  isAdmin: boolean
  passkeys: number
  inviteExpiresAt: number | null
}

export interface CreatedInvite {
  link: string
  expiresAt: number
  username: string
}

export interface SecurityOverview {
  bans: Record<string, { until: number; reason: string }>
  events: { at: string; ip: string; kind: string; detail?: string }[]
}

export class AccountError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AccountError'
    this.status = status
  }
}

async function call<T>(path: string, init: RequestInit = {}, credentials?: SubsonicCredentials): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(credentials ? { 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt } : {}) },
    })
  } catch {
    throw new AccountError(0, 'Could not reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new AccountError(response.status, body.error ?? (response.status === 403 ? 'Access from this network is blocked.' : `The server returned an error (HTTP ${response.status}).`))
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) })

export async function signInWithPasskey(): Promise<SignInResult> {
  const { challengeId, options } = await call<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/auth/passkey/options', post({}))
  const response = await startAuthentication({ optionsJSON: options })
  return call<SignInResult>('/auth/passkey/verify', post({ challengeId, response }))
}

export const inviteApi = {
  get: (token: string) => call<InviteInfo>(`/invites/${encodeURIComponent(token)}`),
  async accept(token: string, deviceName: string): Promise<SignInResult> {
    const { challengeId, options } = await call<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(`/invites/${encodeURIComponent(token)}/options`, post({}))
    const response = await startRegistration({ optionsJSON: options })
    return call<SignInResult>(`/invites/${encodeURIComponent(token)}`, post({ challengeId, response, name: deviceName }))
  },
}

export const accountApi = {
  get: (credentials: SubsonicCredentials) => call<{ passkeys: AccountPasskey[] }>('/account', {}, credentials),
  async addPasskey(credentials: SubsonicCredentials, name: string) {
    const { challengeId, options } = await call<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/account/passkeys/options', post({}), credentials)
    const response = await startRegistration({ optionsJSON: options })
    await call('/account/passkeys', post({ challengeId, response, name }), credentials)
  },
  removePasskey: (credentials: SubsonicCredentials, id: string) => call<void>(`/account/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }, credentials),
}

export const deviceLinkApi = {
  check: (credentials: SubsonicCredentials, code: string) => call<{ deviceName: string; expiresAt: number }>(`/device-links/${encodeURIComponent(code)}`, {}, credentials),
  approve: (credentials: SubsonicCredentials, code: string) => call<{ deviceName: string; username: string }>(`/device-links/${encodeURIComponent(code)}`, post({}), credentials),
}

export const adminApi = {
  users: (credentials: SubsonicCredentials) => call<ManagedUser[]>('/admin/users', {}, credentials),
  createUser: (credentials: SubsonicCredentials, user: { username: string; name: string; isAdmin: boolean }) => call<CreatedInvite>('/admin/users', post(user), credentials),
  createInvite: (credentials: SubsonicCredentials, username: string) => call<CreatedInvite>('/admin/invites', post({ username }), credentials),
  removeAccess: (credentials: SubsonicCredentials, username: string) => call<void>(`/admin/users/${encodeURIComponent(username)}/access`, { method: 'DELETE' }, credentials),
  security: (credentials: SubsonicCredentials) => call<SecurityOverview>('/admin/security', {}, credentials),
  unban: (credentials: SubsonicCredentials, ip: string) => call<void>(`/admin/bans/${encodeURIComponent(ip)}`, { method: 'DELETE' }, credentials),
}

// The browser throws NotAllowedError when the user closes the passkey prompt; that isn't worth an error message.
export function isPasskeyCancel(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

export function messageFor(error: unknown, fallback: string): string {
  return error instanceof AccountError ? error.message : fallback
}

export function deviceName(): string {
  const agent = navigator.userAgent
  if (/iPhone/.test(agent)) return 'iPhone'
  if (/iPad/.test(agent)) return 'iPad'
  if (/Android/.test(agent)) return 'Android'
  if (/Mac/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows PC'
  return 'This device'
}

export function profileLoginOf(result: SignInResult) {
  return { id: result.id, username: result.username, displayName: result.name || result.username, isAdmin: result.isAdmin, token: result.subsonicToken, salt: result.subsonicSalt }
}
