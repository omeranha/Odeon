import { config } from '../config.ts'
import { createJsonStore } from '../jsonStore.ts'
import { normalize } from '../matching.ts'
import type { SubsonicAuth } from '../navidrome.ts'
import { detectLanguage, guessFromTitle, type Language } from './language.ts'

export interface SongRef {
  // The caller's own key for the song, returned in `keep`.
  id: string
  // Navidrome song id, for library songs; their lyrics are read from the file.
  library?: string
  title: string
  artist?: string
  year?: number
  genre?: string
}

interface Cache {
  songs: Record<string, { language: Language | null; at: number }>
  // How many of each artist's songs were found in each language, for songs whose lyrics can't be found.
  artists: Record<string, Partial<Record<Language, number>>>
}

const CACHE_LIMIT = 50_000
// LRCLIB answers "too many requests" to bursts; a failed lookup is retried another time instead of cached.
const LOOKUP_CONCURRENCY = 4
// A language the playlist uses less than this much counts as foreign to it.
const MIN_LANGUAGE_SHARE = 0.15
const MIN_KNOWN_SEEDS = 3
const MIN_ARTIST_SHARE = 0.75
// Songs by an artist with this many songs in one language skip the lyrics lookup.
const ARTIST_SETTLED = 4
// Each year outside the playlist's range moves a song back as far as this many places.
const PLACES_PER_YEAR = 0.8
const PLACES_FOR_OTHER_GENRE = 4

export const firstArtist = (artist?: string) => normalize(artist?.split(/,|&|•|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/i)[0] ?? '')
const firstArtistName = (artist: string) => artist.split(/,|&|•|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim()
// "Laugh Now Cry Later (feat. Lil Durk)" and "Song - Remastered" are filed under the bare title.
const bareTitle = (title: string) => title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() || title

class LookupFailed extends Error {}

// LRCLIB starts answering 429 after about 4 requests a second, so requests are spaced out, and a 429 is retried.
const LRCLIB_SPACING_MS = 320
const LRCLIB_RETRIES = 2
let lrclibNext = 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function lrclibSlot(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, lrclibNext)
  lrclibNext = at + LRCLIB_SPACING_MS
  if (at > now) await sleep(at - now)
}

async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

function quantile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))]
}

async function lrclibLyrics(artist: string, title: string): Promise<string | undefined> {
  const url = `https://lrclib.net/api/search?${new URLSearchParams({ artist_name: firstArtistName(artist), track_name: bareTitle(title) })}`
  for (let attempt = 0; ; attempt++) {
    await lrclibSlot()
    const response = await fetch(url, { headers: { 'User-Agent': 'Odeon (https://github.com/omeranha/Odeon)' }, signal: AbortSignal.timeout(8_000) })
    if (response.status === 429 && attempt < LRCLIB_RETRIES) {
      await response.arrayBuffer()
      await sleep(2_000 * (attempt + 1))
      continue
    }
    if (response.status === 404) return undefined
    if (!response.ok) throw new LookupFailed(`LRCLIB answered ${response.status}`)
    const results = (await response.json()) as { artistName?: string; plainLyrics?: string | null }[]
    const wanted = firstArtist(artist)
    return results.find((result) => result.plainLyrics && (!wanted || normalize(result.artistName ?? '').includes(wanted)))?.plainLyrics ?? undefined
  }
}

// Language comes from the lyrics: Navidrome's copy for library songs (Downtify embeds them in every file), LRCLIB for
// the rest. Each song is looked up once; answers, including "no lyrics", are saved on disk, network errors aren't.
export function createSongFit(options: { storePath?: string; fetchLyrics?: (artist: string, title: string) => Promise<string | undefined> } = {}) {
  const store = createJsonStore<Cache>(options.storePath, { songs: {}, artists: {} })
  const pending = new Map<string, Promise<Language | undefined>>()
  const fetchLyrics = options.fetchLyrics ?? lrclibLyrics

  async function navidromeLyrics(auth: SubsonicAuth, id: string): Promise<string | undefined> {
    const params = new URLSearchParams({ u: auth.username, t: auth.token, s: auth.salt, v: '1.16.1', c: 'odeon-server', f: 'json', id })
    const response = await fetch(`${config.navidromeUrl}/rest/getLyricsBySongId?${params}`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new LookupFailed(`Navidrome answered ${response.status}`)
    const payload = (await response.json()) as { 'subsonic-response'?: { lyricsList?: { structuredLyrics?: { line?: { value?: string }[] }[] } } }
    const text = (payload['subsonic-response']?.lyricsList?.structuredLyrics?.[0]?.line ?? []).map((line) => line.value ?? '').join('\n')
    return text.trim() ? text : undefined
  }

  function cacheKey(song: SongRef): string {
    return song.library ? `library:${song.library}` : `song:${firstArtist(song.artist)}\n${normalize(bareTitle(song.title))}`
  }

  function remember(song: SongRef, language: Language | undefined) {
    store.update((cache) => {
      cache.songs[cacheKey(song)] = { language: language ?? null, at: Date.now() }
      const artist = firstArtist(song.artist)
      if (language && artist) {
        const counts = (cache.artists[artist] ??= {})
        counts[language] = (counts[language] ?? 0) + 1
      }
      const keys = Object.keys(cache.songs)
      if (keys.length > CACHE_LIMIT) for (const old of keys.sort((a, b) => cache.songs[a].at - cache.songs[b].at).slice(0, keys.length - CACHE_LIMIT)) delete cache.songs[old]
    })
  }

  // The song's own language, from its lyrics or title; undefined when neither tells.
  async function songLanguage(auth: SubsonicAuth, song: SongRef): Promise<Language | undefined> {
    const key = cacheKey(song)
    const cached = store.get().songs[key]
    if (cached) return cached.language ?? undefined
    const inFlight = pending.get(key)
    if (inFlight) return inFlight
    const lookup = (async () => {
      try {
        let lyrics = song.library ? await navidromeLyrics(auth, song.library) : undefined
        // An artist already known to sing in one language needn't cost an LRCLIB request per song.
        if (!lyrics && !song.library && artistLanguage(song, ARTIST_SETTLED)) return artistLanguage(song, ARTIST_SETTLED)
        if (!lyrics && song.artist) lyrics = await fetchLyrics(song.artist, song.title)
        const language = (lyrics ? detectLanguage(lyrics) : undefined) ?? guessFromTitle(song.title)
        remember(song, language)
        return language
      } catch {
        return guessFromTitle(song.title)
      }
    })().finally(() => pending.delete(key))
    pending.set(key, lookup)
    return lookup
  }

  // Falls back to the language most of the artist's known songs are in, once at least `minimum` songs are known.
  function artistLanguage(song: SongRef, minimum = 1): Language | undefined {
    const counts = store.get().artists[firstArtist(song.artist)]
    if (!counts) return undefined
    const total = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0)
    const [best, count] = (Object.entries(counts) as [Language, number][]).sort((a, b) => b[1] - a[1])[0] ?? []
    return best && total >= minimum && count / total >= MIN_ARTIST_SHARE ? best : undefined
  }

  async function languageOf(auth: SubsonicAuth, song: SongRef): Promise<Language | undefined> {
    return (await songLanguage(auth, song)) ?? artistLanguage(song)
  }

  return {
    ready: store.ready,
    languageOf,

    // Keeps the candidates that fit the seeds (a playlist, or what played last), in their order of similarity:
    // a language the seeds barely use is dropped; a year outside the seeds' range or a genre they don't have moves a
    // song back. Without enough known seeds a rule is skipped rather than guessed. With a budget, lookups still running
    // when it ends count as unknown for this answer and finish in the background, for the next one.
    async fit(auth: SubsonicAuth, seeds: SongRef[], candidates: SongRef[], budgetMs?: number): Promise<string[]> {
      await store.ready
      const deadline = budgetMs === undefined ? undefined : sleep(budgetMs).then(() => undefined)
      const lookUp = (songs: SongRef[]) => {
        const all = mapLimited(songs, LOOKUP_CONCURRENCY, (song) => songLanguage(auth, song))
        return deadline ? Promise.race([all, deadline.then(() => songs.map(() => undefined))]) : all
      }
      // Seeds first: they teach the artist fallback what the playlist's own artists sing in.
      const seedLanguages = await lookUp(seeds)
      await lookUp(candidates)
      const known = seeds.map((song, index) => seedLanguages[index] ?? artistLanguage(song)).filter((language): language is Language => Boolean(language))
      const candidateLanguages = candidates.map((song) => store.get().songs[cacheKey(song)]?.language ?? artistLanguage(song) ?? guessFromTitle(song.title))
      const languageRule = known.length > 0 && known.length >= Math.min(MIN_KNOWN_SEEDS, seeds.length)
      const share = (language: Language) => known.filter((seed) => seed === language).length / known.length

      const years = seeds.map((song) => song.year).filter((year): year is number => Boolean(year && year > 1900)).sort((a, b) => a - b)
      const yearRule = years.length > 0 && years.length >= Math.min(MIN_KNOWN_SEEDS, seeds.length)
      const [low, high] = yearRule ? [quantile(years, 0.1), quantile(years, 0.9)] : [0, 0]
      const genres = new Set(seeds.map((song) => normalize(song.genre ?? '')).filter(Boolean))

      return candidates
        .map((song, index) => {
          const language = candidateLanguages[index]
          if (languageRule && language && share(language) < MIN_LANGUAGE_SHARE) return undefined
          let places = 0
          if (yearRule && song.year && song.year > 1900) places += Math.max(0, low - song.year, song.year - high) * PLACES_PER_YEAR
          if (genres.size > 0 && song.genre && !genres.has(normalize(song.genre))) places += PLACES_FOR_OTHER_GENRE
          return { id: song.id, rank: index + places }
        })
        .filter((entry): entry is { id: string; rank: number } => Boolean(entry))
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.id)
    },
  }
}

export type SongFit = ReturnType<typeof createSongFit>
