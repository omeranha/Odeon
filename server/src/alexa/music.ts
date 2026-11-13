import type { CatalogTrack, DowntifyClient } from '../downtify.ts'
import { normalize } from '../matching.ts'
import { navidrome, type NavidromeSong, type SubsonicAuth } from '../navidrome.ts'
import type { SongFit, SongRef } from '../recommendations/fit.ts'

export interface AlexaTrack {
  kind: 'library' | 'catalog'
  // A Navidrome song id, or Downtify's catalog id.
  id: string
  title: string
  artist?: string
  duration?: number
  coverArt?: string
  coverUrl?: string
  video?: string
  explicit?: boolean
  suffix?: string
  bitRate?: number
  year?: number
  genre?: string
}

export interface Selection {
  tracks: AlexaTrack[]
  speech: string
}

const ARTIST_SONG_LIMIT = 40
const ARTIST_ALBUM_LIMIT = 6
const SIMILAR_COUNT = 20
// Autoplay judges candidates against this many of the songs that played last.
const RECENT_SEEDS = 10
// Alexa waits 8 seconds for an answer; the rest goes to finding the songs and Amazon's round trip.
const FIT_BUDGET_MS = 3_500

type Kind = 'playlist' | 'album' | 'artist' | 'song'

// What people put in front of a name when asking in Portuguese: "a playlist academia", "músicas do Eminem".
const HINTS: [RegExp, Kind][] = [
  [/^(a |minha )?playlist /, 'playlist'],
  [/^(o )?(album|disco) /, 'album'],
  [/^(o |a )?(artista|banda|cantor|cantora|grupo) /, 'artist'],
  [/^(as )?musicas (do |da |dos |das |de )/, 'artist'],
  [/^(a )?musica /, 'song'],
]
const LIKED = /^(as |minhas |meus )?(musicas )?(curtidas|favoritas|preferidas)$|^minhas musicas$/
const SHUFFLE = /\s*\b(no )?(modo )?(aleatorio|aleatoria|aleatoriamente|embaralhado|embaralhada)\b\s*/

export function fromLibrary(song: NavidromeSong): AlexaTrack {
  return { kind: 'library', id: song.id, title: song.title, artist: song.artist ?? song.displayArtist, duration: song.duration, coverArt: song.coverArt, suffix: song.suffix, bitRate: song.bitRate, year: song.year, genre: song.genre }
}

function fromCatalog(track: CatalogTrack): AlexaTrack {
  return { kind: 'catalog', id: track.id, title: track.title, artist: track.artists.join(', ') || undefined, duration: track.duration, coverUrl: track.coverUrl, video: track.youtubeId, explicit: track.explicit, year: Number(track.year) || undefined }
}

const songRef = (track: AlexaTrack, id: string): SongRef => ({ id, library: track.kind === 'library' ? track.id : undefined, title: track.title, artist: track.artist, year: track.year, genre: track.genre })

const firstArtist = (track: AlexaTrack) => normalize(track.artist?.split(/,|&|\s+feat\.?\s+|\s+ft\.?\s+/i)[0] ?? '')

function sameTrack(a: AlexaTrack, b: AlexaTrack): boolean {
  if (a.kind === b.kind && a.id === b.id) return true
  if (normalize(a.title) !== normalize(b.title)) return false
  const artistA = firstArtist(a)
  const artistB = firstArtist(b)
  return !artistA || !artistB || normalize(a.artist ?? '').includes(artistB) || normalize(b.artist ?? '').includes(artistA)
}

export function withoutKnown(candidates: AlexaTrack[], known: AlexaTrack[]): AlexaTrack[] {
  const seen = [...known]
  return candidates.filter((candidate) => {
    if (seen.some((other) => sameTrack(candidate, other))) return false
    seen.push(candidate)
    return true
  })
}

function interleave<T>(lists: T[][]): T[] {
  const result: T[] = []
  for (let index = 0; lists.some((list) => index < list.length); index++) for (const list of lists) if (index < list.length) result.push(list[index])
  return result
}

// The library's and YouTube Music's lists are taken in turns; a song in both keeps the better place but plays from the
// library, which starts at once instead of waiting for Downtify's download.
function mergeSources(library: AlexaTrack[], catalog: AlexaTrack[], known: AlexaTrack[] = []): AlexaTrack[] {
  return withoutKnown(interleave([library, catalog]), known).map((track) => (track.kind === 'catalog' ? (library.find((own) => sameTrack(own, track)) ?? track) : track))
}

// Same scale as the web app's search: 3 for an exact title (or artist and title), 2 when every word matches.
function matchScore(track: AlexaTrack, phrase: string): number {
  const title = normalize(track.title)
  const artist = normalize(track.artist ?? '')
  if (title === phrase || `${artist} ${title}` === phrase || `${title} ${artist}` === phrase) return 3
  const terms = phrase.split(' ').filter(Boolean)
  const words = `${title} ${artist}`.split(' ')
  const matched = terms.filter((term) => words.some((word) => word.startsWith(term))).length
  if (matched === terms.length) return title.startsWith(phrase) ? 2.5 : 2
  return terms.length > 0 ? matched / terms.length : 0
}

export function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

export function parseRequest(spoken: string): { kind?: Kind; text: string; liked: boolean; shuffle: boolean } {
  let text = normalize(spoken)
  const shuffle = SHUFFLE.test(text)
  text = text.replace(SHUFFLE, ' ').trim()
  if (LIKED.test(text)) return { text, liked: true, shuffle: true }
  for (const [pattern, kind] of HINTS) {
    if (pattern.test(text)) return { kind, text: text.replace(pattern, '').trim(), liked: false, shuffle }
  }
  return { text, liked: false, shuffle }
}

export function createAlexaMusic(options: { auth: () => Promise<SubsonicAuth>; downtify: DowntifyClient | null; fit?: SongFit }) {
  const { auth, downtify, fit } = options

  async function artistTracks(credentials: SubsonicAuth, artist: { id: string; name: string }): Promise<AlexaTrack[]> {
    const [top, albums] = await Promise.all([navidrome.topSongs(credentials, artist.name, 20).catch(() => []), navidrome.artistAlbums(credentials, artist.id).catch(() => [])])
    const albumSongs = (await Promise.all(albums.slice(0, ARTIST_ALBUM_LIMIT).map((album) => navidrome.albumSongs(credentials, album.id).catch(() => [])))).flat()
    return withoutKnown([...top, ...shuffled(albumSongs)].map(fromLibrary), []).slice(0, ARTIST_SONG_LIMIT)
  }

  return {
    async select(spoken: string): Promise<Selection | undefined> {
      const credentials = await auth()
      const request = parseRequest(spoken)
      if (request.liked) {
        const songs = await navidrome.starredSongs(credentials)
        return songs.length > 0 ? { tracks: shuffled(songs.map(fromLibrary)), speech: 'Tocando suas músicas curtidas.' } : undefined
      }
      const phrase = request.text
      if (!phrase) return undefined

      const [library, catalog, playlists] = await Promise.all([
        navidrome.search(credentials, phrase).catch(() => ({ artists: [], albums: [], songs: [] })),
        downtify && request.kind !== 'playlist' && request.kind !== 'album' ? downtify.search(phrase).catch(() => [] as CatalogTrack[]) : Promise.resolve([] as CatalogTrack[]),
        request.kind === 'playlist' || !request.kind ? navidrome.playlists(credentials).catch(() => []) : Promise.resolve([]),
      ])
      const order = (tracks: AlexaTrack[]) => (request.shuffle ? shuffled(tracks) : tracks)

      const playlist = playlists.find((candidate) => normalize(candidate.name) === phrase) ?? (request.kind === 'playlist' ? playlists.find((candidate) => normalize(candidate.name).includes(phrase)) : undefined)
      if (playlist) {
        const songs = (await navidrome.getPlaylist(credentials, playlist.id)).entry ?? []
        if (songs.length > 0) return { tracks: order(songs.map(fromLibrary)), speech: `Tocando a playlist ${playlist.name}.` }
      }

      const album = library.albums.find((candidate) => normalize(candidate.name) === phrase) ?? (request.kind === 'album' ? library.albums[0] : undefined)
      if (album) {
        const songs = await navidrome.albumSongs(credentials, album.id)
        if (songs.length > 0) return { tracks: order(songs.map(fromLibrary)), speech: `Tocando o álbum ${album.name}${album.artist ? `, de ${album.artist}` : ''}.` }
      }

      const catalogTracks = catalog.map(fromCatalog)
      const artist = library.artists.find((candidate) => normalize(candidate.name) === phrase) ?? (request.kind === 'artist' ? library.artists[0] : undefined)
      const catalogArtist = catalogTracks.find((track) => firstArtist(track) === phrase)?.artist?.split(',')[0]?.trim()
      if (artist || catalogArtist) {
        const name = artist?.name ?? catalogArtist ?? phrase
        const own = artist ? await artistTracks(credentials, artist) : []
        const theirs = catalogTracks.filter((track) => firstArtist(track) === normalize(name))
        const tracks = mergeSources(shuffled(own), theirs)
        if (tracks.length > 0) return { tracks: request.kind === 'artist' || request.shuffle ? shuffled(tracks) : tracks, speech: `Tocando músicas de ${name}.` }
      }

      const songs = mergeSources(library.songs.map(fromLibrary), catalogTracks)
      const best = songs.map((track) => ({ track, score: matchScore(track, phrase) })).sort((a, b) => b.score - a.score)[0]
      if (!best || best.score < 0.5) return undefined
      return { tracks: [best.track], speech: `Tocando ${best.track.title}${best.track.artist ? `, de ${best.track.artist}` : ''}.` }
    },

    // Songs like the seeds, from Navidrome's Instant Mix and YouTube Music's radio mix, taken in turns, keeping only
    // those that fit what played recently (same languages, close in years and genre).
    async similar(seeds: AlexaTrack[], known: AlexaTrack[]): Promise<AlexaTrack[]> {
      const credentials = await auth()
      const lists = await Promise.all(
        seeds.map(async (seed) => {
          const [library, catalog] = await Promise.all([
            seed.kind === 'library' ? navidrome.similarSongs(credentials, seed.id, SIMILAR_COUNT).catch(() => []) : Promise.resolve([]),
            downtify ? downtify.similar({ title: seed.title, artist: seed.artist?.split(',')[0]?.trim() }, SIMILAR_COUNT).catch(() => []) : Promise.resolve([]),
          ])
          return mergeSources(library.map(fromLibrary), catalog.map(fromCatalog))
        }),
      )
      const candidates = withoutKnown(interleave(lists), known)
      if (!fit) return candidates.slice(0, SIMILAR_COUNT)
      const recent = known.slice(-RECENT_SEEDS)
      const keep = await fit.fit(credentials, recent.map((track, index) => songRef(track, `seed${index}`)), candidates.map((track, index) => songRef(track, String(index))), FIT_BUDGET_MS).catch(() => candidates.map((_, index) => String(index)))
      return keep.map((index) => candidates[Number(index)]).slice(0, SIMILAR_COUNT)
    },
  }
}

export type AlexaMusic = ReturnType<typeof createAlexaMusic>
