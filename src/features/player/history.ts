const HISTORY_KEY = 'spotydrome-recent-plays'
const HISTORY_LIMIT = 300
const PLAYLISTS_KEY = 'spotydrome-recent-playlists'
const PLAYLISTS_LIMIT = 50

function load(key: string, limit: number): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(0, limit) : []
  } catch {
    return []
  }
}

function save(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // Storage is full or blocked; the history just isn't kept.
  }
}

// Song ids, most recently played first.
let recent = load(HISTORY_KEY, HISTORY_LIMIT)
let recentPlaylists = load(PLAYLISTS_KEY, PLAYLISTS_LIMIT)

export function recordPlay(songId: string) {
  if (recent[0] === songId) return
  recent = [songId, ...recent.filter((id) => id !== songId)].slice(0, HISTORY_LIMIT)
  save(HISTORY_KEY, recent)
}

export function recordPlaylistPlay(playlistId: string) {
  if (recentPlaylists[0] === playlistId) return
  recentPlaylists = [playlistId, ...recentPlaylists.filter((id) => id !== playlistId)].slice(0, PLAYLISTS_LIMIT)
  save(PLAYLISTS_KEY, recentPlaylists)
}

// Playlist ids, most recently played first.
export function recentPlaylistIds(): string[] {
  return recentPlaylists
}

// 1 for the song played last, falling linearly to near 0 for the oldest one remembered.
export function recencyWeights(): Map<string, number> {
  return new Map(recent.map((id, index) => [id, 1 - index / recent.length]))
}
