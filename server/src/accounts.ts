import { createHash, randomBytes } from 'node:crypto'
import { config } from './config.ts'
import { createJsonStore } from './jsonStore.ts'

export interface StoredPasskey {
  id: string
  publicKey: string
  counter: number
  transports?: string[]
  name: string
  createdAt: number
  lastUsedAt?: number
}

export interface Account {
  username: string
  // Sign-in is refused if Navidrome's user id changes: a deleted user that Navidrome re-creates must not regain access.
  navidromeId: string
  webauthnUserId: string
  passkeys: StoredPasskey[]
  createdAt: number
}

export interface Invite {
  username: string
  navidromeId: string
  name: string
  createdBy: string
  createdAt: number
  expiresAt: number
}

interface Data {
  accounts: Record<string, Account>
  // Keyed by the SHA-256 of the invite token; the token itself is only ever in the link.
  invites: Record<string, Invite>
}

export const INVITE_TTL_MS = 48 * 60 * 60_000

const store = createJsonStore<Data>(config.dataDir ? `${config.dataDir}/users.json` : undefined, { accounts: {}, invites: {} })
export const accountsReady = store.ready

const keyOf = (username: string) => username.toLowerCase()
const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url')

export const accounts = {
  get(username: string): Account | undefined {
    return store.get().accounts[keyOf(username)]
  },

  all(): Account[] {
    return Object.values(store.get().accounts)
  },

  findByCredential(credentialId: string): { account: Account; passkey: StoredPasskey } | undefined {
    for (const account of Object.values(store.get().accounts)) {
      const passkey = account.passkeys.find((candidate) => candidate.id === credentialId)
      if (passkey) return { account, passkey }
    }
    return undefined
  },

  // Joining from an invite either creates the account or, for a re-invite, adds a passkey to the existing one.
  webauthnUserIdFor(username: string): string {
    return this.get(username)?.webauthnUserId ?? randomBytes(16).toString('base64url')
  },

  addPasskey(invite: Pick<Invite, 'username' | 'navidromeId'>, webauthnUserId: string, passkey: StoredPasskey) {
    store.update((data) => {
      const key = keyOf(invite.username)
      const existing = data.accounts[key]
      if (existing && existing.navidromeId === invite.navidromeId) existing.passkeys.push(passkey)
      else data.accounts[key] = { username: invite.username, navidromeId: invite.navidromeId, webauthnUserId, passkeys: [passkey], createdAt: Date.now() }
    })
  },

  touchPasskey(username: string, credentialId: string, counter: number) {
    store.update((data) => {
      const passkey = data.accounts[keyOf(username)]?.passkeys.find((candidate) => candidate.id === credentialId)
      if (passkey) Object.assign(passkey, { counter, lastUsedAt: Date.now() })
    })
  },

  removePasskey(username: string, credentialId: string): 'removed' | 'last' | 'missing' {
    const account = this.get(username)
    if (!account?.passkeys.some((passkey) => passkey.id === credentialId)) return 'missing'
    if (account.passkeys.length === 1) return 'last'
    store.update((data) => {
      const target = data.accounts[keyOf(username)]
      if (target) target.passkeys = target.passkeys.filter((passkey) => passkey.id !== credentialId)
    })
    return 'removed'
  },

  removeAccess(username: string): boolean {
    let existed = false
    store.update((data) => {
      existed = Boolean(data.accounts[keyOf(username)]) || Object.values(data.invites).some((invite) => keyOf(invite.username) === keyOf(username))
      delete data.accounts[keyOf(username)]
      for (const [hash, invite] of Object.entries(data.invites)) if (keyOf(invite.username) === keyOf(username)) delete data.invites[hash]
    })
    return existed
  },
}

export const invites = {
  // A new invite replaces any earlier one for the same user, so only the latest link works.
  create(invite: Omit<Invite, 'createdAt' | 'expiresAt'>): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + INVITE_TTL_MS
    store.update((data) => {
      for (const [hash, existing] of Object.entries(data.invites)) if (keyOf(existing.username) === keyOf(invite.username)) delete data.invites[hash]
      data.invites[hashToken(token)] = { ...invite, createdAt: Date.now(), expiresAt }
    })
    return { token, expiresAt }
  },

  find(token: string): Invite | undefined {
    const invite = store.get().invites[hashToken(token)]
    return invite && invite.expiresAt > Date.now() ? invite : undefined
  },

  consume(token: string) {
    store.update((data) => {
      delete data.invites[hashToken(token)]
    })
  },

  pendingFor(username: string): Invite | undefined {
    return Object.values(store.get().invites).find((invite) => keyOf(invite.username) === keyOf(username) && invite.expiresAt > Date.now())
  },
}

interface Challenge {
  value: string
  purpose: string
  expiresAt: number
}

const challenges = new Map<string, Challenge>()

export const webauthnChallenges = {
  save(value: string, purpose: string): string {
    const id = randomBytes(16).toString('base64url')
    challenges.set(id, { value, purpose, expiresAt: Date.now() + 5 * 60_000 })
    if (challenges.size > 5000) challenges.delete(challenges.keys().next().value as string)
    return id
  },

  // Single use: a challenge is deleted as soon as it's read, whatever the outcome.
  take(id: string, purpose: string): string | undefined {
    const challenge = challenges.get(id)
    challenges.delete(id)
    return challenge && challenge.purpose === purpose && challenge.expiresAt > Date.now() ? challenge.value : undefined
  },
}

setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of challenges) if (entry.expiresAt < now) challenges.delete(id)
  store.update((data) => {
    for (const [hash, invite] of Object.entries(data.invites)) if (invite.expiresAt < now) delete data.invites[hash]
  })
}, 10 * 60_000).unref()
