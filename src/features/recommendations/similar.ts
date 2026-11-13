import { catalogTrackToSong, downtifyApi } from '../../lib/downtify'
import { getSimilarSongs } from '../../lib/subsonic/api'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import type { SubsonicSong } from '../../lib/subsonic/types'

export const comparable = (text = '') =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export const firstArtistOf = (song: SubsonicSong) => song.artist?.split(/,|&|\s+feat\.?\s+|\s+ft\.?\s+/i)[0]?.trim()

interface SongKey {
  id: string
  title: string
  artist: string
  firstArtist: string
}

function keyOf(song: SubsonicSong): SongKey {
  return { id: song.id, title: comparable(song.title), artist: comparable(song.artist), firstArtist: comparable(firstArtistOf(song)) }
}

function sameSong(a: SongKey, b: SongKey): boolean {
  if (a.id === b.id) return true
  if (a.title !== b.title) return false
  return !a.firstArtist || !b.firstArtist || a.artist.includes(b.firstArtist) || b.artist.includes(a.firstArtist)
}

// The same song often comes from both Navidrome and YouTube Music, or is already queued; each is kept once, first copy wins.
export function withoutKnown(candidates: SubsonicSong[], known: SubsonicSong[]): SubsonicSong[] {
  const seen = known.map(keyOf)
  const result: SubsonicSong[] = []
  for (const candidate of candidates) {
    const key = keyOf(candidate)
    if (seen.some((other) => sameSong(key, other))) continue
    seen.push(key)
    result.push(candidate)
  }
  return result
}

export interface SimilarContext {
  credentials: SubsonicCredentials
  catalogEnabled: boolean
}

export function interleave<T>(lists: T[][]): T[] {
  const result: T[] = []
  for (let index = 0; lists.some((list) => index < list.length); index++) for (const list of lists) if (index < list.length) result.push(list[index])
  return result
}

// Two lists each ordered by relevance are taken in turns, so neither source is favored. A song in both keeps the better
// position but plays from the library, which starts at once instead of waiting for Downtify's download.
export function mergeSources(library: SubsonicSong[], catalog: SubsonicSong[], known: SubsonicSong[] = []): SubsonicSong[] {
  const libraryKeys = library.map((song) => ({ song, key: keyOf(song) }))
  return withoutKnown(interleave([library, catalog]), known).map((song) => {
    if (!song.external) return song
    const key = keyOf(song)
    return libraryKeys.find((own) => sameSong(own.key, key))?.song ?? song
  })
}

// Navidrome's list comes from Last.fm or Deezer data, the other is YouTube Music's radio mix for the song.
export async function similarSongs({ credentials, catalogEnabled }: SimilarContext, seed: SubsonicSong, count: number, signal?: AbortSignal): Promise<SubsonicSong[]> {
  const artist = firstArtistOf(seed)
  const [library, catalog] = await Promise.all([
    seed.external ? Promise.resolve([]) : getSimilarSongs(credentials, seed.id, count, signal).catch(() => []),
    catalogEnabled ? downtifyApi.similar(credentials, { title: seed.title, artist }, count, signal).catch(() => []) : Promise.resolve([]),
  ])
  return mergeSources(library, catalog.map((track) => catalogTrackToSong(credentials, track)), [seed])
}

// 3: the title, or artist and title, is exactly what was typed. 2: every word matches, 2.5 if the title starts with
// the query. Below 1: the share of words that match. The last word may still be half typed, so prefixes count.
function matchScore(song: SubsonicSong, phrase: string, terms: string[]): number {
  const title = comparable(song.title)
  const artist = comparable(song.artist)
  if (title === phrase || `${artist} ${title}` === phrase || `${title} ${artist}` === phrase) return 3
  const words = `${title} ${artist}`.split(' ')
  const matched = terms.filter((term) => words.some((word) => word.startsWith(term))).length
  if (matched === terms.length) return title.startsWith(phrase) ? 2.5 : 2
  return matched / terms.length
}

// Navidrome and YouTube Music each rank by their own rules, so a merged list is ordered by how well each song matches
// what was typed. Songs that match equally keep their turn-by-turn order (the sort is stable).
export function rankForQuery(songs: SubsonicSong[], query: string): SubsonicSong[] {
  const phrase = comparable(query)
  const terms = phrase.split(' ').filter(Boolean)
  if (terms.length === 0) return songs
  const scores = new Map(songs.map((song) => [song, matchScore(song, phrase, terms)]))
  return [...songs].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
}

// YouTube Music's radio is tuned to where the server is, so a radio for American rap mixes in Brazilian trap. The
// server reads each song's lyrics to tell their language, drops suggestions in a language the seeds barely use, and
// moves back those far from the seeds' years or genres. If it can't be reached, the suggestions are used as they are.
// With a budget, songs it hasn't checked by then are kept this time and known the next.
export async function fitToSeeds(credentials: SubsonicCredentials, seeds: SubsonicSong[], candidates: SubsonicSong[], options: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<SubsonicSong[]> {
  const { signal, budgetMs } = options
  if (seeds.length === 0 || candidates.length === 0) return candidates
  const ref = (song: SubsonicSong, id: string) => ({ id, library: song.external ? undefined : song.id, title: song.title, artist: song.artist, year: song.year, genre: song.genre })
  const limited = candidates.slice(0, 200)
  try {
    const response = await fetch('/api/recommendations/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Subsonic-User': credentials.username, 'X-Subsonic-Token': credentials.token, 'X-Subsonic-Salt': credentials.salt },
      body: JSON.stringify({ seeds: seeds.slice(0, 50).map((song, index) => ref(song, `seed${index}`)), candidates: limited.map((song, index) => ref(song, String(index))), budgetMs }),
      signal,
    })
    if (!response.ok) return candidates
    const { keep } = (await response.json()) as { keep: string[] }
    return keep.map((index) => limited[Number(index)]).filter((song): song is SubsonicSong => Boolean(song))
  } catch (error) {
    if (signal?.aborted) throw error
    return candidates
  }
}
