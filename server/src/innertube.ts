export type AudioCodec = 'aac' | 'any'

interface ClientDefinition {
  name: string
  id: number
  userAgent: string
  context: Record<string, unknown>
}

// Client identities as yt-dlp defines them (extractor/youtube/_base.py, INNERTUBE_CLIENTS). YouTube changes the accepted
// versions from time to time, and then these two entries are what to update; every failure falls back to Downtify.
const ANDROID_VR_AGENT = 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'
const VISIONOS_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const CLIENTS: ClientDefinition[] = [
  {
    name: 'ANDROID_VR',
    id: 28,
    userAgent: ANDROID_VR_AGENT,
    context: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, userAgent: ANDROID_VR_AGENT, osName: 'Android', osVersion: '12L', hl: 'en' },
  },
  {
    name: 'VISIONOS',
    id: 101,
    userAgent: VISIONOS_AGENT,
    context: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', userAgent: VISIONOS_AGENT, osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en' },
  },
]

interface RawFormat {
  itag?: number
  url?: string
  mimeType?: string
  bitrate?: number
  contentLength?: string
}

export interface AudioSource {
  url: string
  userAgent: string
  client: string
  itag: number
  kbps: number
  contentType: string
  size: number
}

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false'
const REQUEST_TIMEOUT_MS = 15_000
const SOURCE_TTL_MS = 5 * 60 * 60 * 1000
const VISITOR_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_LIMIT = 500

function headersFor(client: ClientDefinition, visitorData: string | undefined): Record<string, string> {
  const version = String((client.context as { clientVersion: string }).clientVersion)
  return { 'Content-Type': 'application/json', 'User-Agent': client.userAgent, 'X-YouTube-Client-Name': String(client.id), 'X-YouTube-Client-Version': version, ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}) }
}

export function createInnertube() {
  const sources = new Map<string, { at: number; ready: Promise<AudioSource> }>()
  let visitor: { at: number; ready: Promise<string | undefined> } | undefined

  // Without a visitor id YouTube often answers "sign in to confirm you're not a bot".
  function visitorData(): Promise<string | undefined> {
    if (visitor && Date.now() - visitor.at < VISITOR_TTL_MS) return visitor.ready
    const client = CLIENTS[0]
    const ready = fetch(BROWSE_URL, { method: 'POST', headers: headersFor(client, undefined), body: JSON.stringify({ context: { client: client.context }, browseId: 'FEwhat_to_watch' }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      .then(async (response) => ((await response.json()) as { responseContext?: { visitorData?: string } }).responseContext?.visitorData)
      .catch(() => undefined)
    visitor = { at: Date.now(), ready }
    void ready.then((value) => !value && (visitor = undefined))
    return ready
  }

  async function playerResponse(client: ClientDefinition, videoId: string): Promise<RawFormat[]> {
    const visitorId = await visitorData()
    const body = { context: { client: { ...client.context, ...(visitorId ? { visitorData: visitorId } : {}) } }, videoId, contentCheckOk: true, racyCheckOk: true, playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } } }
    const response = await fetch(PLAYER_URL, { method: 'POST', headers: headersFor(client, visitorId), body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${client.name} answered HTTP ${response.status}`)
    const data = (await response.json()) as { playabilityStatus?: { status?: string; reason?: string }; streamingData?: { adaptiveFormats?: RawFormat[] } }
    if (data.playabilityStatus?.status !== 'OK') throw new Error(`${client.name}: ${data.playabilityStatus?.status ?? 'no answer'}${data.playabilityStatus?.reason ? ` (${data.playabilityStatus.reason})` : ''}`)
    return data.streamingData?.adaptiveFormats ?? []
  }

  // Some clients only serve a short preview of a stream, which passes a check of the first bytes but fails on the last.
  async function servesWholeFile(url: string, userAgent: string, size: number): Promise<boolean> {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent, Range: `bytes=${size - 1}-${size - 1}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    await response.body?.cancel()
    return response.status === 206
  }

  // The highest-bitrate audio. `aac` keeps to AAC in MP4, which every browser and the car app decode; `any` also allows Opus,
  // a little better at the same size, for browsers that play it. Surround formats (AC-3) have the highest bitrates and play nowhere.
  function pick(formats: RawFormat[], codec: AudioCodec): RawFormat | undefined {
    const wanted = codec === 'aac' ? ['mp4a'] : ['mp4a', 'opus']
    const audio = formats.filter((format) => format.url && format.mimeType?.startsWith('audio/') && Number(format.contentLength) > 0 && wanted.some((name) => format.mimeType?.includes(name)))
    return audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
  }

  async function resolveNow(videoId: string, codec: AudioCodec): Promise<AudioSource> {
    const reasons: string[] = []
    for (const client of CLIENTS) {
      try {
        const format = pick(await playerResponse(client, videoId), codec)
        if (!format?.url) {
          reasons.push(`${client.name}: no direct audio`)
          continue
        }
        const size = Number(format.contentLength)
        if (!(await servesWholeFile(format.url, client.userAgent, size))) {
          reasons.push(`${client.name}: preview only`)
          continue
        }
        return { url: format.url, userAgent: client.userAgent, client: client.name, itag: format.itag ?? 0, kbps: Math.round((format.bitrate ?? 0) / 1000), contentType: (format.mimeType ?? 'audio/mp4').split(';')[0], size }
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error))
      }
    }
    throw new Error(reasons.join('; '))
  }

  function resolve(videoId: string, codec: AudioCodec): Promise<AudioSource> {
    const key = `${videoId}:${codec}`
    const cached = sources.get(key)
    if (cached && Date.now() - cached.at < SOURCE_TTL_MS) return cached.ready
    const ready = resolveNow(videoId, codec)
    if (sources.size >= CACHE_LIMIT) sources.delete(sources.keys().next().value as string)
    sources.set(key, { at: Date.now(), ready })
    ready.catch(() => sources.delete(key))
    return ready
  }

  async function open(source: AudioSource, range: string | undefined): Promise<Response> {
    return fetch(source.url, { headers: { 'User-Agent': source.userAgent, Range: range ?? 'bytes=0-' }, signal: AbortSignal.timeout(60_000) })
  }

  return {
    resolve,

    // The first lookup after a start also fetches the visitor id (about a second), so it is done before anyone plays.
    warmUp() {
      void visitorData()
    },

    // Passes the audio through as it arrives and supports seeking. An expired link is looked up again once.
    async serve(videoId: string, codec: AudioCodec, range: string | undefined): Promise<Response> {
      let source = await resolve(videoId, codec)
      let upstream = await open(source, range)
      if (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) {
        await upstream.body?.cancel()
        sources.delete(`${videoId}:${codec}`)
        source = await resolve(videoId, codec)
        upstream = await open(source, range)
      }
      if (!upstream.ok) {
        await upstream.body?.cancel()
        throw new Error(`YouTube answered HTTP ${upstream.status}`)
      }
      const headers = new Headers({ 'content-type': source.contentType, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' })
      for (const name of ['content-length', 'content-range']) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
    },
  }
}

export type Innertube = ReturnType<typeof createInnertube>
