export interface SubsonicResponseBase {
  status: 'ok' | 'failed'
  version: string
  type?: string
  serverVersion?: string
  openSubsonic?: boolean
  error?: { code: number; message: string }
}

export interface SubsonicSong {
  id: string
  title: string
  album?: string
  albumId?: string
  artist?: string
  artistId?: string
  track?: number
  discNumber?: number
  year?: number
  genre?: string
  coverArt?: string
  duration?: number
  bitRate?: number
  // OpenSubsonic: the file's sample size and rate, which Navidrome reads from the tags.
  bitDepth?: number
  samplingRate?: number
  suffix?: string
  contentType?: string
  size?: number
  starred?: string
  playCount?: number
  // OpenSubsonic; Navidrome reads it from the file's iTunes advisory tag.
  explicitStatus?: 'explicit' | 'clean' | ''
  // Set by the app for songs streamed through Downtify that aren't in the Navidrome library yet.
  external?: { streamUrl: string; coverUrl?: string; catalogId: string; explicit?: boolean }
  // Set by the app on songs it added to the queue itself: autoplay after the queue ends, or smart shuffle.
  suggested?: 'autoplay' | 'smart'
}

export interface SubsonicAlbum {
  id: string
  name: string
  artist?: string
  artistId?: string
  coverArt?: string
  songCount: number
  duration: number
  year?: number
  genre?: string
  starred?: string
  created: string
  playCount?: number
}

export interface AlbumWithSongs extends SubsonicAlbum {
  song?: SubsonicSong[]
}

export interface SubsonicArtist {
  id: string
  name: string
  albumCount?: number
  coverArt?: string
  artistImageUrl?: string
  starred?: string
}

export interface ArtistWithAlbums extends SubsonicArtist {
  album?: SubsonicAlbum[]
}

export interface ArtistInfo {
  biography?: string
  largeImageUrl?: string
  mediumImageUrl?: string
  similarArtist?: SubsonicArtist[]
}

export interface SubsonicPlaylist {
  id: string
  name: string
  comment?: string
  owner?: string
  public?: boolean
  songCount: number
  duration: number
  created: string
  changed: string
  coverArt?: string
  readonly?: boolean
}

export interface PlaylistWithSongs extends SubsonicPlaylist {
  entry?: SubsonicSong[]
}

export interface SearchResults {
  artists: SubsonicArtist[]
  albums: SubsonicAlbum[]
  songs: SubsonicSong[]
}

export interface StarredItems {
  artist?: SubsonicArtist[]
  album?: SubsonicAlbum[]
  song?: SubsonicSong[]
}

export type AlbumListType = 'random' | 'newest' | 'highest' | 'frequent' | 'recent' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'starred'
