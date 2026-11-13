import { useEffect } from 'react'
import { showToast } from '../../components/toastStore'
import { COVER_SIZES } from '../../lib/offlineCaches'
import { getCoverArtUrl, getStreamUrl, scrobble } from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { getOfflineAudioUrl, useDownloadStore } from '../downloads/downloadManager'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { recordPlay, recordPlaylistPlay } from './history'
import { usePlayerStore } from './playerStore'
import { prefetchStream } from './prefetch'
import { useProgressStore } from './progressStore'

const audio = new Audio()
audio.preload = 'auto'

let context: { credentials: SubsonicCredentials } | null = null
let loadedSong: SubsonicSong | null = null
let streamIsRaw = true
// Transcoded streams can't be range-requested, so seeking outside the buffer restarts the stream with `timeOffset`, and element time is relative to it.
let streamOffset = 0
let nowPlayingReported = false
let scrobbled = false
let lastPositionStateUpdate = 0
let priming = false
let primed = false
let silentClip = ''
let loadToken = 0
let pendingLoad: Promise<void> | null = null
let objectUrl: string | null = null
// Set before a queue loads (e.g. playback moved here from another device) so the next song starts at that point.
let startAt = 0
let pendingElementSeek = 0
// A dropped connection (server restart, flaky Wi-Fi) ends or breaks the stream early; it's resumed from the same spot.
let recoveries = 0
const MAX_RECOVERIES = 3
const EARLY_END_SECONDS = 5

export function getAudioElement(): HTMLAudioElement {
  return audio
}

export function setStartPosition(seconds: number) {
  startAt = Math.max(0, seconds)
}

// audio.volume scales amplitude linearly, but loudness is heard logarithmically, so a linear slider sounds loud almost
// all the way down. Cubing the position gives about -18 dB at the middle and -60 dB at a tenth.
function sliderToGain(position: number): number {
  return position ** 3
}

// Kept apart from the persisted queue, which would otherwise be rewritten several times a second.
const POSITION_KEY = 'spotydrome-position'
const POSITION_SAVE_MS = 5000
let positionSavedAt = 0

function savedPosition(songId: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as { songId?: unknown; position?: unknown } | null
    return saved?.songId === songId && typeof saved.position === 'number' && saved.position > 0 ? saved.position : 0
  } catch {
    return 0
  }
}

function savePosition(force = false) {
  if (!loadedSong || priming) return
  const now = Date.now()
  if (!force && now - positionSavedAt < POSITION_SAVE_MS) return
  positionSavedAt = now
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ songId: loadedSong.id, position: useProgressStore.getState().position }))
  } catch {
    // Storage is full or blocked; the song just starts over after a reload.
  }
}

// Loading a source resets the element's time to 0 until it can seek, so the target is reported meanwhile.
function currentPosition(): number {
  return pendingElementSeek > 0 ? pendingElementSeek : streamOffset + audio.currentTime
}

function songDuration(): number {
  if (loadedSong?.duration) return loadedSong.duration
  return Number.isFinite(audio.duration) ? streamOffset + audio.duration : 0
}

function setSource(url: string) {
  if (objectUrl && objectUrl !== url) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  audio.src = url
}

function loadStream(song: SubsonicSong, offset: number) {
  if (song.external) {
    streamOffset = 0
    streamIsRaw = true
    pendingElementSeek = offset
    setSource(directFailed.has(song.id) ? withoutDirect(song.external.streamUrl) : song.external.streamUrl)
    return
  }
  if (!context) return
  // Always the original file: Navidrome sends it untouched and seeks with range requests.
  streamOffset = 0
  streamIsRaw = true
  pendingElementSeek = offset
  setSource(getStreamUrl(context.credentials, song.id, { format: 'raw', maxBitRate: 0 }))
}

function loadSong(song: SubsonicSong | undefined) {
  const token = ++loadToken
  loadedSong = song ?? null
  nowPlayingReported = false
  scrobbled = false
  pendingLoad = null
  recoveries = 0
  pendingElementSeek = 0
  // Only the first load after the page opens resumes; choosing a song later starts it from the beginning.
  const start = startAt || (song && usePlayerStore.getState().playbackId === 0 ? savedPosition(song.id) : 0)
  startAt = 0
  registerMediaSessionHandlers()
  updateMediaMetadata(loadedSong)
  if (!song) {
    streamOffset = 0
    audio.removeAttribute('src')
    audio.load()
    useProgressStore.setState({ position: 0, duration: 0 })
    return
  }
  useProgressStore.setState({ position: start, duration: song.duration ?? 0 })
  savePosition(true)

  // Streamed songs load synchronously so play() stays inside the user's tap, which iOS requires.
  if (useDownloadStore.getState().songs[song.id]?.state !== 'done') {
    loadStream(song, start)
    return
  }
  pendingLoad = getOfflineAudioUrl(song.id)
    .catch(() => undefined)
    .then((offlineUrl) => {
      if (token !== loadToken) {
        if (offlineUrl) URL.revokeObjectURL(offlineUrl)
        return
      }
      if (!offlineUrl) {
        loadStream(song, start)
        return
      }
      streamOffset = 0
      streamIsRaw = true
      pendingElementSeek = start
      setSource(offlineUrl)
      objectUrl = offlineUrl
    })
}

// Downtify downloads a whole song before it serves the first byte, which is what makes a first play wait. The next
// song is fetched into its cache while this one plays, so moving on to it starts right away.
function prefetchNext() {
  const { queue, currentIndex, repeat } = usePlayerStore.getState()
  prefetchStream((queue[currentIndex + 1] ?? (repeat === 'all' ? queue[0] : undefined))?.external?.streamUrl)
}

// The server plays a YouTube Music song straight from YouTube (direct=1). A browser that can't decode that stream gets the
// file Downtify prepares instead, once per song.
const directFailed = new Set<string>()

function withoutDirect(streamUrl: string): string {
  const url = new URL(streamUrl, window.location.origin)
  url.searchParams.delete('direct')
  url.searchParams.delete('codec')
  return `${url.pathname}${url.search}`
}

function switchToPreparedFile(): boolean {
  if (!loadedSong?.external || directFailed.has(loadedSong.id) || !loadedSong.external.streamUrl.includes('direct=1')) return false
  directFailed.add(loadedSong.id)
  loadStream(loadedSong, currentPosition())
  if (usePlayerStore.getState().isPlaying) startPlayback()
  return true
}

// Picks the stream up again where it broke off. Returns false once a song has failed too often to keep trying.
function recover(): boolean {
  if (!loadedSong || recoveries >= MAX_RECOVERIES || !navigator.onLine) return false
  recoveries++
  const song = loadedSong
  const position = currentPosition()
  const token = loadToken
  setTimeout(() => {
    if (token !== loadToken || loadedSong !== song) return
    loadStream(song, position)
    if (usePlayerStore.getState().isPlaying) startPlayback()
  }, 1500 * recoveries)
  return true
}

function startPlayback() {
  const play = () =>
    audio.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      usePlayerStore.getState().setPlaying(false)
    })
  if (!pendingLoad) {
    void play()
    return
  }
  const token = loadToken
  void pendingLoad.then(() => {
    if (token === loadToken && usePlayerStore.getState().isPlaying) void play()
  })
}

function isSeekable(time: number): boolean {
  for (let range = 0; range < audio.seekable.length; range++) {
    if (time >= audio.seekable.start(range) && time <= audio.seekable.end(range)) return true
  }
  return false
}

export function seekTo(seconds: number) {
  if (!loadedSong) return
  const duration = songDuration()
  const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.5) : seconds)
  const relative = target - streamOffset
  if (streamIsRaw || (relative >= 0 && isSeekable(relative))) {
    if (pendingElementSeek > 0) pendingElementSeek = relative
    else audio.currentTime = relative
  } else {
    loadStream(loadedSong, target)
    if (usePlayerStore.getState().isPlaying) startPlayback()
  }
  useProgressStore.setState({ position: target })
  updatePositionState(true)
  savePosition(true)
}

export function previousOrRestart() {
  if (currentPosition() > 3) seekTo(0)
  else usePlayerStore.getState().previous()
}

// iOS only lets an audio element start playing inside a user gesture. Playback that starts after a network fetch
// (e.g. the play button on an album card) would be blocked, so the element is unlocked synchronously with a silent clip first.
export function primeAudio() {
  if (primed) return
  primed = true
  priming = true
  if (!audio.getAttribute('src')) {
    silentClip = silentClipUrl()
    audio.src = silentClip
  }
  audio
    .play()
    .then(() => audio.pause())
    .catch(() => undefined)
    .finally(() => {
      priming = false
    })
}

function silentClipUrl(): string {
  const sampleCount = 800
  const buffer = new ArrayBuffer(44 + sampleCount)
  const view = new DataView(buffer)
  const writeText = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount, true)
  writeText(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeText(36, 'data')
  view.setUint32(40, sampleCount, true)
  new Uint8Array(buffer, 44).fill(128)
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function updateMediaMetadata(song: SubsonicSong | null) {
  if (!('mediaSession' in navigator)) return
  if (!song || !context) {
    navigator.mediaSession.metadata = null
    return
  }
  const { credentials } = context
  const coverArt = song.coverArt
  const externalCover = song.external?.coverUrl
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist ?? '',
    album: song.album ?? '',
    artwork: externalCover ? [{ src: externalCover }] : coverArt ? COVER_SIZES.map((size) => ({ src: getCoverArtUrl(credentials, coverArt, size), sizes: `${size}x${size}` })) : [],
  })
}

function updatePositionState(force = false) {
  if (!('mediaSession' in navigator)) return
  const now = performance.now()
  if (!force && now - lastPositionStateUpdate < 1000) return
  lastPositionStateUpdate = now
  const duration = songDuration()
  if (duration <= 0) return
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(Math.max(0, currentPosition()), duration), playbackRate: audio.playbackRate || 1 })
  } catch {
    // Some browsers reject position updates while metadata is still loading.
  }
}

function reportPlayback() {
  if (!loadedSong || !context || loadedSong.external) return
  const { credentials } = context
  const songId = loadedSong.id
  if (!nowPlayingReported) {
    nowPlayingReported = true
    void scrobble(credentials, songId, false).catch(() => undefined)
  }
  const duration = songDuration()
  const position = currentPosition()
  if (!scrobbled && duration > 0 && (position >= duration / 2 || position >= 240)) {
    scrobbled = true
    void scrobble(credentials, songId, true).catch(() => undefined)
  }
}

audio.addEventListener('timeupdate', () => {
  if (priming) return
  useProgressStore.setState({ position: currentPosition() })
  updatePositionState()
  savePosition()
  if (!audio.paused) reportPlayback()
})

audio.addEventListener('durationchange', () => {
  if (!priming && !loadedSong?.duration && Number.isFinite(audio.duration)) useProgressStore.setState({ duration: songDuration() })
})

audio.addEventListener('loadedmetadata', () => {
  // The song's source can finish loading while the unlock clip is still priming; its start position must still apply.
  if (pendingElementSeek <= 0 || audio.src === silentClip) return
  audio.currentTime = pendingElementSeek
  pendingElementSeek = 0
})

audio.addEventListener('playing', () => {
  if (priming) return
  recoveries = 0
  if (loadedSong) recordPlay(loadedSong.id)
  const { source } = usePlayerStore.getState()
  if (source?.type === 'playlist' && source.id) recordPlaylistPlay(source.id)
  prefetchNext()
})

audio.addEventListener('play', () => {
  if (!priming) usePlayerStore.getState().setPlaying(true)
})

audio.addEventListener('pause', () => {
  // Loading a new source pauses the element too; only external pauses (headphones unplugged, phone calls) should update the UI.
  if (priming || audio.ended || audio.readyState === HTMLMediaElement.HAVE_NOTHING) return
  savePosition(true)
  usePlayerStore.getState().setPlaying(false)
})

audio.addEventListener('ended', () => {
  if (priming) return
  // A transcoded stream that loses its connection just ends, with no error; far from the end that's an interruption.
  const duration = loadedSong?.duration ?? 0
  if (duration > 0 && currentPosition() < duration - EARLY_END_SECONDS && recover()) return
  const { repeat, next } = usePlayerStore.getState()
  if (repeat !== 'one') {
    next()
    return
  }
  seekTo(0)
  startPlayback()
})

audio.addEventListener('error', () => {
  if (priming || !loadedSong) return
  if (switchToPreparedFile()) return
  if (recover()) return
  usePlayerStore.getState().setPlaying(false)
  showToast(navigator.onLine ? "This song can't be played right now." : "You're offline. Downloaded songs still play.")
})

window.addEventListener('pagehide', () => savePosition(true))
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && savePosition(true))

// seekbackward/seekforward must stay unregistered: iOS swaps the lock screen's previous/next buttons for 10 second skips when they have handlers.
const mediaSessionHandlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
  ['play', () => usePlayerStore.getState().setPlaying(true)],
  ['pause', () => usePlayerStore.getState().setPlaying(false)],
  ['previoustrack', () => previousOrRestart()],
  ['nexttrack', () => usePlayerStore.getState().next()],
  ['seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime)],
  ['seekbackward', null],
  ['seekforward', null],
]

// Registered again for every song because iOS only decides which buttons the lock screen shows when it builds the now-playing entry.
function registerMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return
  for (const [action, handler] of mediaSessionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Unsupported action on this browser.
    }
  }
}

registerMediaSessionHandlers()

export function usePlayerEngine() {
  const profile = useCurrentProfile()
  const playbackId = usePlayerStore((state) => state.playbackId)
  const isPlaying = usePlayerStore((state) => state.isPlaying)
  const volume = usePlayerStore((state) => state.volume)
  const muted = usePlayerStore((state) => state.muted)

  useEffect(() => {
    context = { credentials: credentialsOf(profile) }
  }, [profile])

  useEffect(() => {
    const { queue, currentIndex } = usePlayerStore.getState()
    loadSong(queue[currentIndex])
  }, [playbackId])

  useEffect(() => {
    if (!loadedSong) return
    if (isPlaying) startPlayback()
    else audio.pause()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying, playbackId])

  useEffect(() => {
    audio.volume = muted ? 0 : sliderToGain(volume)
  }, [volume, muted])

  useEffect(() => () => audio.pause(), [])
}
