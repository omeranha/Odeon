import type { NavidromeSong } from './navidrome.ts'

export interface TrackToMatch {
  title: string
  artists: string[]
  duration?: number
}

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const VERSION_SUFFIX = /\s+-\s+.*$/
const BRACKETED = /\s*[([].*?[)\]]/g
const FEATURING = /\s+(feat\.?|ft\.?|featuring|with)\s+.*$/i

// "Song (feat. X) - Remastered 2011" -> "Song": the part that survives however other tools tag the file.
function strippedTitle(title: string): string {
  return title.replace(BRACKETED, '').replace(VERSION_SUFFIX, '').replace(FEATURING, '').trim()
}

function baseTitle(title: string): string {
  return normalize(strippedTitle(title))
}

export function sameBaseTitle(a: string, b: string): boolean {
  const base = baseTitle(a)
  return base.length > 0 && base === baseTitle(b)
}

export function searchQueriesFor(track: TrackToMatch): string[] {
  const stripped = strippedTitle(track.title) || track.title
  const firstArtist = track.artists[0]?.trim()
  return [...new Set([track.title, stripped, firstArtist ? `${firstArtist} ${stripped}` : ''].map((query) => query.trim()).filter(Boolean))]
}

function songArtistNames(song: NavidromeSong): string[] {
  return [song.artist, song.displayArtist, song.albumArtist, ...(song.artists ?? []).map((artist) => artist.name)].filter((name): name is string => Boolean(name)).map(normalize)
}

export function pickMatch(track: TrackToMatch, songs: NavidromeSong[]): NavidromeSong | undefined {
  const title = normalize(track.title)
  const base = baseTitle(track.title)
  const artists = track.artists.map(normalize).filter(Boolean)
  if (!title) return undefined

  const artistMatches = (song: NavidromeSong) => {
    if (artists.length === 0) return true
    const names = songArtistNames(song)
    const joined = names.join(' ')
    return artists.some((artist) => joined.includes(artist) || names.some((name) => name.length > 2 && artist.includes(name)))
  }
  const lengthWithin = (song: NavidromeSong, seconds: number) => !track.duration || !song.duration || Math.abs(song.duration - track.duration) <= seconds
  const sameBase = (song: NavidromeSong) => base.length > 0 && baseTitle(song.title) === base

  return (
    songs.find((song) => normalize(song.title) === title && artistMatches(song) && lengthWithin(song, 10)) ??
    songs.find((song) => sameBase(song) && artistMatches(song) && lengthWithin(song, 4)) ??
    // Artist tags vary most between tools; a same-title song of nearly identical length is almost always the one.
    songs.find((song) => sameBase(song) && base.length >= 4 && Boolean(track.duration && song.duration) && lengthWithin(song, 2))
  )
}

// Words that make a recording a different version of the same song.
const VARIANT_WORDS = new Set(['remix', 'live', 'acoustic', 'instrumental', 'edit', 'radio', 'sped', 'slowed', 'reverb', 'cover', 'demo', 'karaoke', 'extended', 'session', 'reprise', 'mix'])

function variantsOf(title: string): string {
  return normalize(title)
    .split(' ')
    .filter((word) => VARIANT_WORDS.has(word))
    .sort()
    .join(' ')
}

// "Song (feat. X)" is "Song", but "Song - Live" or "Song (Remix)" is not.
export function sameRecording(a: string, b: string): boolean {
  return sameBaseTitle(a, b) && variantsOf(a) === variantsOf(b)
}

// A shared file's title from its name: "05 - Song.flac" and "Artist - Song.flac" both give "Song".
export function titleFromFilename(filename: string, artist: string | undefined): string {
  const name = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[A-Za-z0-9]{2,5}$/, '')
  const withoutNumber = name.replace(/^\s*(?:cd|disc)?\s*\d{1,3}\s*[-._)]*\s*/i, '')
  const parts = withoutNumber.split(/\s+-\s+/)
  if (parts.length > 1 && artist && normalize(parts[0]).includes(normalize(artist))) return parts.slice(1).join(' - ').trim()
  return withoutNumber.trim()
}

export function stripTitle(title: string): string {
  return strippedTitle(title) || title
}
