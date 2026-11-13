import { useEffect } from 'react'
import { showToast } from '../../components/toastStore'
import { AUDIO_CACHE, audioCacheKey } from '../../lib/offlineCaches'
import { getAlbum, getSong, getStreamUrl } from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useCurrentProfile } from '../profiles/profileStore'
import { useDownloadStore } from './downloadManager'
import { offlineDb, type OfflineSong } from './offlineDb'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const LOOKUPS_AT_ONCE = 4
let lastCheck = 0

async function inBatches<T>(items: T[], work: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(Array.from({ length: Math.min(LOOKUPS_AT_ONCE, pending.length) }, async () => {
    for (let item = pending.shift(); item !== undefined; item = pending.shift()) await work(item)
  }))
}

// Albums answer for all their songs at once; a song with no album is asked for on its own.
async function currentSongs(downloaded: OfflineSong[], credentials: SubsonicCredentials): Promise<Map<string, SubsonicSong>> {
  const found = new Map<string, SubsonicSong>()
  const albumIds = [...new Set(downloaded.map((offline) => offline.song.albumId).filter((id): id is string => Boolean(id)))]
  await inBatches(albumIds, async (albumId) => {
    const album = await getAlbum(credentials, albumId).catch(() => undefined)
    for (const song of album?.song ?? []) found.set(song.id, song)
  })
  await inBatches(
    downloaded.filter((offline) => !found.has(offline.id)),
    async (offline) => {
      const song = await getSong(credentials, offline.id).catch(() => undefined)
      if (song) found.set(song.id, song)
    },
  )
  return found
}

async function refreshSong(offline: OfflineSong, current: SubsonicSong, credentials: SubsonicCredentials) {
  const response = await fetch(getStreamUrl(credentials, offline.id, { format: 'raw', maxBitRate: 0 }), { cache: 'reload' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const cache = await caches.open(AUDIO_CACHE)
  const key = audioCacheKey(offline.id)
  await cache.put(key, new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg' } }))

  const { hydrated, songs } = useDownloadStore.getState()
  if (hydrated && !songs[offline.id]) {
    await cache.delete(key)
    return
  }
  await offlineDb.putSong({ ...offline, song: { ...offline.song, ...current }, bytes: Number(response.headers.get('Content-Length')) || current.size || offline.bytes, downloadedAt: Date.now() })
}

// Navidrome reports a different size once a song's file is replaced (a better-quality copy, a clean or explicit swap).
export async function refreshChangedDownloads(credentials: SubsonicCredentials): Promise<number> {
  if (!navigator.onLine) return 0
  const downloaded = await offlineDb.allSongs()
  if (downloaded.length === 0) return 0
  const current = await currentSongs(downloaded, credentials)
  const outdated = downloaded.filter((offline) => {
    const latest = current.get(offline.id)
    return latest?.size !== undefined && offline.song.size !== undefined && latest.size !== offline.song.size
  })

  let refreshed = 0
  for (const offline of outdated) {
    try {
      await refreshSong(offline, current.get(offline.id)!, credentials)
      refreshed++
    } catch {
      // The old copy stays playable and is tried again at the next check.
    }
  }
  if (refreshed > 0) showToast(`Updated ${refreshed} downloaded ${refreshed === 1 ? 'song' : 'songs'}.`)
  return refreshed
}

export function useRefreshChangedDownloads() {
  const { username, token, salt } = useCurrentProfile()
  useEffect(() => {
    const credentials = { username, token, salt }
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_INTERVAL_MS) return
      lastCheck = Date.now()
      void refreshChangedDownloads(credentials).catch(() => undefined)
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [username, token, salt])
}
