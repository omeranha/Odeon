import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createJsonStore } from '../jsonStore.ts'
import { shuffled, type AlexaTrack } from './music.ts'
import type { AudioItem } from './types.ts'

const STREAM_LINK_TTL_S = 12 * 60 * 60
const STREAM_BITRATE = 320
// Repeated recovery attempts on one broken song would loop forever, so a failure moves on after this many.
const MAX_FAILURES_PER_TRACK = 1

export interface DeviceQueue {
  tracks: AlexaTrack[]
  index: number
  // Bumped for every new queue, so events about a previous queue's songs are ignored.
  generation: number
  shuffle: boolean
  loop: boolean
  // Where playback stopped, for resuming.
  offsetMs: number
  failures: number
}

// What a signed stream link points at: a library song (with a start second for transcoded streams) or a Downtify song.
export interface StreamTarget {
  library?: string
  startSeconds?: number
  video?: string
  title?: string
  artist?: string
  duration?: number
  explicit?: boolean
  cover?: string
  expires: number
}

// Navidrome ignores timeOffset for a file it sends as-is (MP3 at or under the bitrate cap), so those are started with
// Alexa's own offset, which it reaches with range requests. Transcoded streams start at the right second instead.
function sentAsIs(track: AlexaTrack): boolean {
  return track.kind === 'catalog' || (track.suffix?.toLowerCase() === 'mp3' && track.bitRate !== undefined && track.bitRate <= STREAM_BITRATE)
}

export function createAlexaPlayer(options: { publicUrl: string; storePath?: string; secret?: Buffer }) {
  // Kept in memory: after a restart, links already handed to an Echo fail once and are replaced with fresh ones.
  const secret = options.secret ?? randomBytes(32)
  const store = createJsonStore<Record<string, DeviceQueue>>(options.storePath, {})

  const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

  function link(kind: 'stream' | 'cover', target: Omit<StreamTarget, 'expires'>): string {
    const payload = Buffer.from(JSON.stringify({ ...target, expires: Math.floor(Date.now() / 1000) + STREAM_LINK_TTL_S })).toString('base64url')
    return `${options.publicUrl}/api/alexa/${kind}/${payload}.${sign(payload)}`
  }

  function token(queue: DeviceQueue, index: number, startMs: number): string {
    return `${queue.generation}:${index}:${startMs}`
  }

  return {
    ready: store.ready,

    readLink(value: string): StreamTarget | undefined {
      const [payload, signature] = value.split('.')
      if (!payload || !signature) return undefined
      const expected = Buffer.from(sign(payload))
      const given = Buffer.from(signature)
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
      try {
        const target = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StreamTarget
        return target.expires > Date.now() / 1000 ? target : undefined
      } catch {
        return undefined
      }
    },

    queueOf(device: string): DeviceQueue | undefined {
      return store.get()[device]
    },

    start(device: string, tracks: AlexaTrack[]): DeviceQueue {
      const previous = store.get()[device]
      const queue: DeviceQueue = { tracks, index: 0, generation: (previous?.generation ?? 0) + 1, shuffle: false, loop: previous?.loop ?? false, offsetMs: 0, failures: 0 }
      store.update((queues) => {
        queues[device] = queue
      })
      return queue
    },

    save(device: string, change: (queue: DeviceQueue) => void) {
      store.update((queues) => {
        const queue = queues[device]
        if (queue) change(queue)
      })
    },

    // Index and start position of the song a token was issued for, when it belongs to the current queue.
    readToken(device: string, value: string | undefined): { index: number; startMs: number } | undefined {
      const queue = store.get()[device]
      const [generation, index, startMs] = (value ?? '').split(':').map(Number)
      if (!queue || generation !== queue.generation || !Number.isInteger(index) || index < 0 || index >= queue.tracks.length) return undefined
      return { index, startMs: Number.isFinite(startMs) ? startMs : 0 }
    },

    shuffleUpcoming(device: string, on: boolean) {
      store.update((queues) => {
        const queue = queues[device]
        if (!queue) return
        queue.shuffle = on
        if (on) queue.tracks = [...queue.tracks.slice(0, queue.index + 1), ...shuffled(queue.tracks.slice(queue.index + 1))]
      })
    },

    append(device: string, generation: number, tracks: AlexaTrack[]) {
      store.update((queues) => {
        const queue = queues[device]
        if (queue && queue.generation === generation) queue.tracks.push(...tracks)
      })
    },

    audioItem(queue: DeviceQueue, index: number, startMs: number): AudioItem {
      const track = queue.tracks[index]
      const asIs = sentAsIs(track)
      const startSeconds = asIs ? 0 : Math.floor(startMs / 1000)
      const target: Omit<StreamTarget, 'expires'> =
        track.kind === 'library' ? { library: track.id, startSeconds: startSeconds || undefined } : { video: track.video, title: track.title, artist: track.artist, duration: track.duration, explicit: track.explicit || undefined }
      const art = track.coverUrl?.startsWith('https://') ? track.coverUrl : track.coverArt ? link('cover', { cover: track.coverArt }) : undefined
      return {
        stream: { url: link('stream', target), token: token(queue, index, startSeconds * 1000), offsetInMilliseconds: asIs ? startMs : 0 },
        metadata: { title: track.title, subtitle: track.artist, ...(art ? { art: { sources: [{ url: art }] } } : {}) },
      }
    },

    maxFailures: MAX_FAILURES_PER_TRACK,
  }
}

export type AlexaPlayer = ReturnType<typeof createAlexaPlayer>
