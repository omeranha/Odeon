import type { SubsonicSong } from '../../lib/subsonic/types'
import { comparable, rankForQuery } from './similar'

// What sits in brackets or after a dash in a title and is not a different version of the song.
const HARMLESS_SUFFIX = /^(feat|ft|featuring|with|prod|from|remaster|remastered|\d{4}|explicit|clean|deluxe|bonus|album version|original|single version|soundtrack|ost|stereo|mono|mix \d)\b/
// Words in the album or artist that mark karaoke, tribute and cover collections.
const COLLECTION_CUES = /\b(karaoke|tribute|covers?|made famous|originally performed|instrumentals?|lullaby|8 bit)\b/
const SAME_SONG_SECONDS = 3

const SUFFIXES = [/[([]([^)\]]+)[)\]]/g, /\s[-–|]\s(.+)$/g]

function suffixesOf(title: string): string[] {
  const found: string[] = []
  for (const pattern of SUFFIXES) for (const match of title.matchAll(pattern)) found.push(comparable(match[1]))
  return found.filter(Boolean)
}

// A version the query did not ask for: "(Afro House)", "- Live at ...", "(Karaoke Version)", a covers album.
// Words the query contains are not held against a song, so searching "blinding lights remix" keeps remixes.
function isOtherVersion(song: SubsonicSong, queryTerms: Set<string>): boolean {
  const asked = (text: string) => text.split(' ').every((word) => queryTerms.has(word))
  if (suffixesOf(song.title).some((suffix) => !HARMLESS_SUFFIX.test(suffix) && !asked(suffix))) return true
  const cues = comparable(`${song.album ?? ''} ${song.artist ?? ''}`)
  const cue = COLLECTION_CUES.exec(cues)?.[1]
  return Boolean(cue && !queryTerms.has(cue))
}

function creditedArtists(song: SubsonicSong): string[] {
  return (song.artist ?? '')
    .split(/,|&|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/i)
    .map(comparable)
    .filter(Boolean)
}

// An artist counts as named when every word of their name is in the query (or starts the word being typed).
function namedArtists(songs: SubsonicSong[], queryTerms: string[]): Set<string> {
  const named = new Set<string>()
  for (const song of songs) {
    const titleWords = new Set(comparable(song.title).split(' '))
    for (const artist of creditedArtists(song)) {
      const words = artist.split(' ')
      // An artist whose whole name is part of the song's title (a band called Summer, a song called Cruel Summer) is not named.
      if (words.every((word) => titleWords.has(word))) continue
      if (words.length > 0 && words.every((word) => queryTerms.some((term) => term === word || (word.length > 2 && word.startsWith(term) && term.length > 2)))) named.add(artist)
    }
  }
  return named
}

function withoutRepeats(songs: SubsonicSong[]): SubsonicSong[] {
  const kept: SubsonicSong[] = []
  for (const song of songs) {
    if (!song.external) {
      kept.push(song)
      continue
    }
    const title = comparable(song.title)
    const artist = creditedArtists(song)[0] ?? ''
    const repeat = kept.some((other) => other.external && comparable(other.title) === title && (creditedArtists(other)[0] ?? '') === artist && (!song.duration || !other.duration || Math.abs(song.duration - other.duration) <= SAME_SONG_SECONDS))
    if (!repeat) kept.push(song)
  }
  return kept
}

export interface OrganizedSongs {
  main: SubsonicSong[]
  more: SubsonicSong[]
}

// Songs in your library are never set aside. Of the YouTube Music results, those that are another version of the song,
// or by someone other than the artist named in the query, go to `more`. The same recording listed under several albums
// shows once. If nothing else is left, the set-aside songs are shown, so a search for a remix still finds it.
export function organizeSearchSongs(songs: SubsonicSong[], query: string): OrganizedSongs {
  const terms = comparable(query).split(' ').filter(Boolean)
  const queryTerms = new Set(terms)
  const named = namedArtists(songs, terms)
  const main: SubsonicSong[] = []
  const more: SubsonicSong[] = []
  for (const song of withoutRepeats(songs)) {
    const otherArtist = song.external && named.size > 0 && !creditedArtists(song).some((artist) => named.has(artist))
    if (song.external && (otherArtist || isOtherVersion(song, queryTerms))) more.push(song)
    else main.push(song)
  }
  const ranked = rankForQuery(main, query)
  return ranked.length > 0 ? { main: ranked, more: rankForQuery(more, query) } : { main: rankForQuery(more, query), more: [] }
}
