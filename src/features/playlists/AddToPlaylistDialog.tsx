import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { pluralize } from '../../lib/format'
import type { SubsonicPlaylist, SubsonicSong } from '../../lib/subsonic/types'
import { CoverArt } from '../library/cards'
import { useLibraryFetchers, usePlaylists } from '../library/queries'
import { useCurrentProfile } from '../profiles/profileStore'
import { useAddToPlaylistStore } from './addToPlaylistStore'
import { canEditPlaylist, nextPlaylistName, usePlaylistMutations } from './mutations'

export function AddToPlaylistDialog() {
  const songs = useAddToPlaylistStore((state) => state.songs)
  const close = useAddToPlaylistStore((state) => state.close)
  if (!songs) return null
  return <AddToPlaylistContent songs={songs} onClose={close} />
}

function AddToPlaylistContent({ songs, onClose }: { songs: SubsonicSong[]; onClose: () => void }) {
  const profile = useCurrentProfile()
  const { data: playlists = [], isPending } = usePlaylists()
  const fetchers = useLibraryFetchers()
  const { create, addSongs } = usePlaylistMutations()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const songIds = songs.map((song) => song.id)
  const term = filter.trim().toLowerCase()
  const editable = playlists.filter((playlist) => canEditPlaylist(playlist, profile) && playlist.name.toLowerCase().includes(term))

  async function handleSelect(playlist: SubsonicPlaylist) {
    setBusy(true)
    try {
      const details = await fetchers.playlist(playlist.id)
      const existing = new Set(details.entry?.map((song) => song.id))
      const alreadyAdded = songIds.every((id) => existing.has(id))
      if (alreadyAdded && !window.confirm(`${songs.length === 1 ? 'This song is' : 'These songs are'} already in ${playlist.name}. Add anyway?`)) return
      if (await addSongs(playlist, songIds)) onClose()
    } catch {
      showToast("Couldn't load the playlist. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    setBusy(true)
    const name = songs.length === 1 ? songs[0].title : nextPlaylistName(playlists, profile)
    const created = await create(name, songIds)
    setBusy(false)
    if (created) {
      showToast(`Added to ${created.name}`)
      onClose()
    }
  }

  return (
    <Dialog title="Add to playlist" onClose={onClose}>
      <label className="mb-3 flex items-center gap-2 rounded bg-highlight px-3 py-2 focus-within:ring-2 focus-within:ring-white">
        <Search className="size-4 text-subdued" />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a playlist" className="w-full bg-transparent text-base outline-none placeholder:text-subdued md:text-sm" />
      </label>

      <button type="button" disabled={busy} onClick={() => void handleCreate()} className="flex w-full items-center gap-3 rounded p-2 text-left hover:bg-highlight disabled:opacity-50">
        <span className="grid size-12 place-items-center rounded bg-highlight">
          <Plus className="size-6" />
        </span>
        <span className="font-semibold">New playlist</span>
      </button>

      <ul className="mt-1">
        {editable.map((playlist) => (
          <li key={playlist.id}>
            <button type="button" disabled={busy} onClick={() => void handleSelect(playlist)} className="flex w-full items-center gap-3 rounded p-2 text-left hover:bg-highlight disabled:opacity-50">
              <CoverArt coverArtId={playlist.coverArt} size={96} kind="playlist" className="size-12 rounded" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{playlist.name}</span>
                <span className="block truncate text-sm text-subdued">{pluralize(playlist.songCount, 'song')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!isPending && editable.length === 0 && <p className="py-4 text-center text-sm text-subdued">{term ? 'No playlists match your search.' : "You don't have any playlists yet."}</p>}
    </Dialog>
  )
}
