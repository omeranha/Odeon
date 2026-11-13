import { useQuery } from '@tanstack/react-query'
import { fetchLyricsFromServer, type Lyrics } from '../../lib/downtify'
import { getLyricsBySongId } from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useCredentials } from '../library/queries'

const NO_LYRICS: Lyrics = { synced: null, plain: null }

async function fromLibrary(credentials: SubsonicCredentials, songId: string, signal: AbortSignal): Promise<Lyrics> {
  try {
    const found = await getLyricsBySongId(credentials, songId, signal)
    const synced = found.find((entry) => entry.synced && entry.line.length > 0)
    if (synced) return { synced: synced.line.map((line) => ({ time: (line.start ?? 0) / 1000, text: line.value })), plain: null }
    const plain = found.find((entry) => entry.line.length > 0)
    return plain ? { synced: null, plain: plain.line.map((line) => line.value).join('\n') } : NO_LYRICS
  } catch {
    return NO_LYRICS
  }
}

// The library's copy is preferred; LRCLIB (through the backend) fills in synced lyrics and songs outside the library.
async function findLyrics(credentials: SubsonicCredentials, song: SubsonicSong, signal: AbortSignal): Promise<Lyrics> {
  const library = song.external ? NO_LYRICS : await fromLibrary(credentials, song.id, signal)
  if (library.synced) return library
  if (!song.artist) return library
  try {
    const online = await fetchLyricsFromServer(credentials, { title: song.title, artist: song.artist.split(',')[0].trim(), album: song.album, duration: song.duration }, signal)
    if (online.synced || online.plain) return online
  } catch {
    // The library's plain lyrics, if any, are still shown.
  }
  return library
}

export function useLyrics(song: SubsonicSong | undefined) {
  const credentials = useCredentials()
  return useQuery({
    queryKey: ['lyrics', song?.id],
    queryFn: ({ signal }) => findLyrics(credentials, song as SubsonicSong, signal),
    enabled: Boolean(song),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  })
}

export function activeLineIndex(lines: { time: number }[], position: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (lines[middle].time <= position + 0.15) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
