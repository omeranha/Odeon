import { Hono, type Context } from 'hono'
import { requestAuth, requireNavidromeUser } from './auth.ts'
import type { SubsonicAuth } from './navidrome.ts'

// One playback session per account, shared by the user's devices (browsers, phones, the car tablet). Every device
// reports what it plays and long-polls for commands. The device that starts playing becomes the active one and the
// others are told to pause, so only one plays at a time; any device can control the active one or move playback.

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/
const ONLINE_MS = 60_000
const FORGET_MS = 24 * 60 * 60_000
const MAX_DEVICES_PER_USER = 10
const MAX_PENDING_COMMANDS = 20
const MAX_QUEUE_SONGS = 500
const MAX_UPCOMING = 200
const TRANSFER_GRACE_MS = 15_000
const POLL_WAIT_MS = 25_000
const COMMAND_TYPES = new Set(['toggle', 'play', 'pause', 'next', 'previous', 'seek', 'jump', 'shuffle', 'repeat', 'playQueue', 'transfer'])

export interface RemoteSong {
  id: string
  title: string
  artist?: string
  album?: string
  albumId?: string
  coverArt?: string
  duration?: number
  suffix?: string
  bitRate?: number
  external?: { catalogId: string; coverUrl?: string; video?: string; title?: string; artist?: string; explicit?: boolean }
}

interface RemoteState {
  song: RemoteSong | null
  playing: boolean
  positionMs: number
  durationMs: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  upcoming: RemoteSong[]
  reportedAt: number
}

type Command = { type: string; positionMs?: number; index?: number; songs?: RemoteSong[]; startIndex?: number; playing?: boolean }

interface Device {
  id: string
  name: string
  kind: 'browser' | 'car' | 'other'
  lastSeen: number
  state: RemoteState | null
  reportedPlaying?: boolean
  // Set when a queue is sent to the device: until it reports that song, its reports are the old queue and are ignored.
  pendingTransfer?: { songId: string; until: number }
  commands: Command[]
  waiter?: () => void
}

interface Session {
  devices: Map<string, Device>
  activeId?: string
}

const sessions = new Map<string, Session>()

const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)
const number = (value: unknown, max: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : undefined)

// Songs are rebuilt field by field, so neither side can push credentials or arbitrary data through the relay.
function cleanSong(value: unknown): RemoteSong | undefined {
  if (!value || typeof value !== 'object') return undefined
  const song = value as Record<string, unknown>
  const id = text(song.id, 200)
  const title = text(song.title, 300)
  if (!id || !title) return undefined
  const external = song.external && typeof song.external === 'object' ? (song.external as Record<string, unknown>) : undefined
  const catalogId = external ? text(external.catalogId, 200) : undefined
  const coverUrl = external ? text(external.coverUrl, 1000) : undefined
  return {
    id,
    title,
    artist: text(song.artist, 300),
    album: text(song.album, 300),
    albumId: text(song.albumId, 200),
    coverArt: text(song.coverArt, 200),
    duration: number(song.duration, 24 * 3600),
    suffix: text(song.suffix, 10),
    bitRate: number(song.bitRate, 100_000),
    external: catalogId ? { catalogId, coverUrl: coverUrl && /^https:\/\//.test(coverUrl) ? coverUrl : undefined, video: text(external?.video, 20), title: text(external?.title, 300), artist: text(external?.artist, 300), explicit: external?.explicit === true || undefined } : undefined,
  }
}

function cleanSongs(value: unknown, max: number): RemoteSong[] {
  return Array.isArray(value) ? value.slice(0, max).map(cleanSong).filter((song): song is RemoteSong => Boolean(song)) : []
}

function sessionOf(username: string): Session {
  const key = username.toLowerCase()
  let session = sessions.get(key)
  if (!session) {
    session = { devices: new Map() }
    sessions.set(key, session)
  }
  return session
}

function usernameOf(c: Context): string {
  return (requestAuth(c) as SubsonicAuth).username
}

function deviceFor(c: Context, create: boolean): { session: Session; device: Device } | undefined {
  const id = c.req.param('id') ?? ''
  if (!DEVICE_ID.test(id)) return undefined
  const session = sessionOf(usernameOf(c))
  let device = session.devices.get(id)
  if (!device && create) {
    if (session.devices.size >= MAX_DEVICES_PER_USER) {
      const stalest = [...session.devices.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]
      forget(session, stalest)
    }
    device = { id, name: 'Device', kind: 'other', lastSeen: Date.now(), state: null, commands: [] }
    session.devices.set(id, device)
  }
  return device ? { session, device } : undefined
}

function forget(session: Session, device: Device) {
  device.waiter?.()
  session.devices.delete(device.id)
  if (session.activeId === device.id) session.activeId = undefined
}

function send(device: Device, command: Command) {
  if (device.commands.length >= MAX_PENDING_COMMANDS) device.commands.shift()
  device.commands.push(command)
  device.waiter?.()
}

const online = (device: Device) => Date.now() - device.lastSeen < ONLINE_MS

// Starting playback anywhere makes that device the active one; whatever else was playing is paused.
function claim(session: Session, device: Device) {
  if (session.activeId !== device.id) session.activeId = device.id
  for (const other of session.devices.values()) {
    if (other.id !== device.id && other.state?.playing) {
      send(other, { type: 'pause' })
      other.state.playing = false
    }
  }
}

function publicView(session: Session, device: Device) {
  // The age lets the controller advance the position itself without trusting that both clocks agree.
  const state = device.state && { ...device.state, ageMs: Date.now() - device.state.reportedAt }
  return { id: device.id, name: device.name, kind: device.kind, online: online(device), active: session.activeId === device.id, lastSeen: device.lastSeen, state }
}

setInterval(() => {
  for (const session of sessions.values()) for (const device of [...session.devices.values()]) if (Date.now() - device.lastSeen > FORGET_MS) forget(session, device)
}, 10 * 60_000).unref()

export function remoteRoutes() {
  const app = new Hono()
  app.use('*', requireNavidromeUser)

  // ---- Reported by each device about itself.

  app.put('/devices/:id', async (c) => {
    const found = deviceFor(c, true)
    if (!found) return c.json({ error: 'Invalid device id' }, 400)
    const { session, device } = found
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const state = (body.state ?? {}) as Record<string, unknown>
    device.name = text(body.name, 40) ?? device.name
    device.kind = body.kind === 'browser' || body.kind === 'car' ? body.kind : device.kind
    device.lastSeen = Date.now()
    const reportedSong = cleanSong(state.song)
    if (device.pendingTransfer && Date.now() < device.pendingTransfer.until && reportedSong?.id !== device.pendingTransfer.songId) return c.json({ active: session.activeId === device.id })
    device.pendingTransfer = undefined
    // Only a change to playing claims the session: a stale "playing" heartbeat sent before a pause arrived must not.
    const startedPlaying = state.playing === true && !device.reportedPlaying
    device.reportedPlaying = state.playing === true
    device.state = {
      song: reportedSong ?? null,
      playing: state.playing === true,
      positionMs: number(state.positionMs, 24 * 3600_000) ?? 0,
      durationMs: number(state.durationMs, 24 * 3600_000) ?? 0,
      shuffle: state.shuffle === true,
      repeat: state.repeat === 'all' || state.repeat === 'one' ? state.repeat : 'off',
      upcoming: cleanSongs(state.upcoming, MAX_UPCOMING),
      reportedAt: Date.now(),
    }
    if (startedPlaying) claim(session, device)
    return c.json({ active: session.activeId === device.id })
  })

  app.get('/devices/:id/commands', async (c) => {
    const found = deviceFor(c, true)
    if (!found) return c.json({ error: 'Invalid device id' }, 400)
    const { device } = found
    device.lastSeen = Date.now()
    if (device.commands.length === 0) {
      device.waiter?.()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, POLL_WAIT_MS)
        function done() {
          clearTimeout(timer)
          if (device.waiter === done) device.waiter = undefined
          resolve()
        }
        device.waiter = done
        c.req.raw.signal.addEventListener('abort', done)
      })
    }
    device.lastSeen = Date.now()
    return c.json({ commands: device.commands.splice(0) })
  })

  app.delete('/devices/:id', (c) => {
    const found = deviceFor(c, false)
    if (found) forget(found.session, found.device)
    return c.body(null, 204)
  })

  // ---- Used to see and control the session.

  app.get('/devices', (c) => {
    const session = sessionOf(usernameOf(c))
    return c.json([...session.devices.values()].filter(online).map((device) => publicView(session, device)).sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeen - a.lastSeen))
  })

  app.post('/devices/:id/commands', async (c) => {
    const found = deviceFor(c, false)
    if (!found || !online(found.device)) return c.json({ error: 'That device is not connected' }, 404)
    const { session, device } = found
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    const type = typeof body.type === 'string' && COMMAND_TYPES.has(body.type) ? body.type : undefined
    if (!type) return c.json({ error: 'Unknown command' }, 400)
    const command: Command = { type }
    if (type === 'seek') command.positionMs = number(body.positionMs, 24 * 3600_000) ?? 0
    if (type === 'jump') command.index = Math.floor(number(body.index, MAX_QUEUE_SONGS) ?? 0)
    if (type === 'playQueue' || type === 'transfer') {
      command.songs = cleanSongs(body.songs, MAX_QUEUE_SONGS)
      if (command.songs.length === 0) return c.json({ error: 'Nothing to play' }, 400)
      command.startIndex = Math.min(command.songs.length - 1, Math.floor(number(body.startIndex, MAX_QUEUE_SONGS) ?? 0))
      command.positionMs = number(body.positionMs, 24 * 3600_000) ?? 0
      command.playing = body.playing !== false
    }
    send(device, command)
    // Moving playback hands the session over right away, before the target reports back. Controllers read the target's
    // state at once, so it shows the moved song instead of whatever that device played last.
    if (type === 'transfer' || type === 'playQueue') {
      const song = command.songs?.[command.startIndex ?? 0]
      if (song && command.songs) {
        const start = command.startIndex ?? 0
        device.state = {
          song,
          playing: command.playing === true,
          positionMs: command.positionMs ?? 0,
          durationMs: (song.duration ?? 0) * 1000,
          shuffle: false,
          repeat: device.state?.repeat ?? 'off',
          upcoming: command.songs.slice(start, start + MAX_UPCOMING),
          reportedAt: Date.now(),
        }
        device.reportedPlaying = command.playing === true
        device.pendingTransfer = { songId: song.id, until: Date.now() + TRANSFER_GRACE_MS }
      }
      if (command.playing) claim(session, device)
    }
    return c.body(null, 202)
  })

  return app
}
