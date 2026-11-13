import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { config } from './config.ts'
import { createJsonStore } from './jsonStore.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const FAILED_AUTH_LIMIT = 20
const FAILED_AUTH_WINDOW = HOUR
const BAN_DURATION = 24 * HOUR
const PROBE_LIMIT = 2

// Paths only vulnerability scanners ask for. Nothing in Odeon or Navidrome lives under them.
const PROBE_PATTERNS = [
  /^\/\.(env|git|svn|hg|aws|ssh|docker|htaccess|htpasswd|DS_Store)/i,
  /^\/(wp-admin|wp-login|wp-content|wp-includes|wordpress|xmlrpc\.php)/i,
  /^\/(phpmyadmin|pma|myadmin|adminer|mysql|sqlite|dbadmin)/i,
  /^\/(cgi-bin|boaform|hnap1|actuator|solr|jenkins|manager\/html|server-status|telescope|_ignition)/i,
  /^\/vendor\/phpunit/i,
  /\.(php|asp|aspx|jsp|cgi)(\?|$)/i,
]

interface Ban {
  until: number
  reason: string
}

interface SecurityEvent {
  at: string
  ip: string
  kind: string
  detail?: string
}

const banStore = createJsonStore<Record<string, Ban>>(config.dataDir ? `${config.dataDir}/bans.json` : undefined, {})
const counters = new Map<string, number[]>()
const recentEvents: SecurityEvent[] = []

function parseIPv4(ip: string): number | undefined {
  const parts = ip.replace(/^::ffff:/, '').split('.')
  if (parts.length !== 4) return undefined
  const bytes = parts.map(Number)
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return undefined
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsText] = cidr.split('/')
  const address = parseIPv4(ip)
  const base = parseIPv4(range)
  const bits = Number(bitsText ?? 32)
  if (address === undefined || base === undefined) return ip === range
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (address & mask) === (base & mask)
}

function isTrustedProxy(ip: string): boolean {
  return config.trustedProxies.some((cidr) => inCidr(ip, cidr))
}

function isLoopback(ip: string): boolean {
  return ip === '::1' || ip.replace(/^::ffff:/, '').startsWith('127.')
}

// Behind Cloudflare Tunnel every connection comes from cloudflared, so the visitor's address is only in
// CF-Connecting-IP. That header is believed only when the connection itself comes from a trusted proxy.
export function clientIp(c: Context): string {
  let socketIp = 'unknown'
  try {
    socketIp = getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    // Not running on the Node adapter (tests).
  }
  if (!isTrustedProxy(socketIp)) return socketIp
  const forwarded = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || socketIp
}

function canBan(ip: string): boolean {
  return ip !== 'unknown' && !isLoopback(ip) && !isTrustedProxy(ip)
}

export function logSecurityEvent(ip: string, kind: string, detail?: string) {
  const event = { at: new Date().toISOString(), ip, kind, detail }
  recentEvents.push(event)
  if (recentEvents.length > 500) recentEvents.shift()
  console.warn(`[security] ${event.at} ${kind} ip=${ip}${detail ? ` ${detail}` : ''}`)
}

function hit(key: string, windowMs: number): number {
  const now = Date.now()
  const times = (counters.get(key) ?? []).filter((time) => now - time < windowMs)
  times.push(now)
  counters.set(key, times)
  return times.length
}

function peek(key: string, windowMs: number): number {
  const now = Date.now()
  return (counters.get(key) ?? []).filter((time) => now - time < windowMs).length
}

setInterval(() => {
  const now = Date.now()
  for (const [key, times] of counters) if (times.every((time) => now - time > 2 * HOUR)) counters.delete(key)
  banStore.update((bans) => {
    for (const [ip, ban] of Object.entries(bans)) if (ban.until < now) delete bans[ip]
  })
}, 10 * MINUTE).unref()

export function ban(ip: string, reason: string) {
  if (!canBan(ip)) return
  banStore.update((bans) => {
    bans[ip] = { until: Date.now() + BAN_DURATION, reason }
  })
  logSecurityEvent(ip, 'banned', reason)
}

export function isBanned(ip: string): boolean {
  const entry = banStore.get()[ip]
  return Boolean(entry && entry.until > Date.now())
}

// Every failed login, code or token check from one address counts toward a ban, whichever endpoint it was.
// With a dedupe key (e.g. a stale token an open tab keeps sending), the same key only counts once per hour.
const countedFailures = new Map<string, number>()

export function recordFailedAuth(ip: string, detail: string, dedupeKey?: string) {
  if (dedupeKey) {
    const key = `${ip}\n${dedupeKey}`
    const last = countedFailures.get(key)
    if (last && Date.now() - last < HOUR) return
    if (countedFailures.size > 10_000) countedFailures.clear()
    countedFailures.set(key, Date.now())
  }
  logSecurityEvent(ip, 'auth_failed', detail)
  if (hit(`fail:${ip}`, FAILED_AUTH_WINDOW) >= FAILED_AUTH_LIMIT) ban(ip, `${FAILED_AUTH_LIMIT} failed logins within an hour`)
}

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  if (peek(key, windowMs) >= limit) return true
  hit(key, windowMs)
  return false
}

// Navidrome throttles logins per address and sees all of Odeon as one address, so a few bad guesses would make it
// reject everyone's valid tokens for a while. Addresses that just failed are stopped here before they reach it.
export function coolingDown(ip: string): boolean {
  return peek(`fail:${ip}`, MINUTE) >= 3
}

export function retryAfterSeconds(windowMs: number) {
  return String(Math.ceil(windowMs / 1000))
}

export const guard: MiddlewareHandler = async (c, next) => {
  const ip = clientIp(c)
  c.set('clientIp' as never, ip as never)
  if (isBanned(ip)) return c.text('Forbidden', 403)

  const path = c.req.path
  if (PROBE_PATTERNS.some((pattern) => pattern.test(path))) {
    logSecurityEvent(ip, 'probe', path.slice(0, 200))
    if (hit(`probe:${ip}`, HOUR) >= PROBE_LIMIT) ban(ip, 'scanning for vulnerable files')
    return c.text('Not found', 404)
  }

  // Generous enough for a library page loading dozens of covers, low enough to stop floods.
  if (rateLimited(`req:${ip}`, 1500, MINUTE)) {
    logSecurityEvent(ip, 'rate_limited', 'requests')
    return c.text('Too many requests', 429, { 'Retry-After': '60' })
  }
  await next()
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  if ((c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')) === 'https') c.header('Strict-Transport-Security', 'max-age=31536000')
  const type = c.res.headers.get('content-type') ?? ''
  if (type.includes('text/html')) {
    // External images are YouTube/Spotify covers in search results; everything else stays on this origin.
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
  }
}

export function recentSecurityEvents(): SecurityEvent[] {
  return recentEvents.slice(-100).reverse()
}

export function activeBans(): Record<string, Ban> {
  const now = Date.now()
  return Object.fromEntries(Object.entries(banStore.get()).filter(([, entry]) => entry.until > now))
}

export function unban(ip: string): boolean {
  const existed = Boolean(banStore.get()[ip])
  banStore.update((bans) => {
    delete bans[ip]
  })
  counters.delete(`fail:${ip}`)
  counters.delete(`probe:${ip}`)
  return existed
}
