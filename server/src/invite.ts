import { readFileSync } from 'node:fs'
import { INTERNAL_TOKEN_PATH } from './internalTokenPath.ts'

const username = process.argv[2]?.trim()
if (!username) {
  console.error('Usage: node src/invite.ts <navidrome-admin-username>')
  process.exit(1)
}

let token: string
try {
  token = readFileSync(INTERNAL_TOKEN_PATH, 'utf8').trim()
} catch {
  console.error(`Could not read ${INTERNAL_TOKEN_PATH}. Is the Odeon server running?`)
  process.exit(1)
}

const port = process.env.PORT?.trim() || '3000'
const response = await fetch(`http://127.0.0.1:${port}/internal/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token }, body: JSON.stringify({ username }) }).catch((error: unknown) => {
  console.error(`The Odeon server on port ${port} is not reachable: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
const result = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { link?: string; expiresAt?: number; username?: string; error?: string }
if (!response.ok || !result.link) {
  console.error(result.error ?? `HTTP ${response.status}`)
  process.exit(1)
}
console.log(`Invite for ${result.username}, valid until ${new Date(result.expiresAt ?? 0).toLocaleString()}:`)
console.log(result.link)
