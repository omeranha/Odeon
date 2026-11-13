import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { useDebouncedValue } from '../../lib/hooks'
import type { SubsonicPlaylist } from '../../lib/subsonic/types'
import { CoverArt } from '../library/cards'
import { useSearch } from '../library/queries'
import { usePlaylistMutations } from './mutations'

export function PlaylistSongFinder({ playlist, onClose }: { playlist: SubsonicPlaylist; onClose?: () => void }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const { data } = useSearch(debouncedQuery)
  const { addSongs } = usePlaylistMutations()
  const songs = query.trim() ? (data?.songs.slice(0, 12) ?? []) : []

  return (
    <section className="mt-6 border-t border-white/10 px-4 pt-6 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="mb-4 text-xl font-bold md:text-2xl">Let's find something for your playlist</h2>
        {onClose && (
          <button type="button" aria-label="Close search" onClick={onClose} className="text-subdued hover:text-white">
            <X className="size-6" />
          </button>
        )}
      </div>
      <label className="flex max-w-md items-center gap-2 rounded bg-highlight px-3 py-2.5 focus-within:ring-2 focus-within:ring-white">
        <Search className="size-4 text-subdued" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for songs" className="w-full bg-transparent text-base outline-none placeholder:text-subdued md:text-sm" />
      </label>

      <ul className="mt-4">
        {songs.map((song) => (
          <li key={song.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-white/10">
            <CoverArt coverArtId={song.coverArt} size={80} className="size-10 rounded" />
            <div className="min-w-0 flex-1">
              <p className="truncate">{song.title}</p>
              <p className="truncate text-sm text-subdued">{song.artist}</p>
            </div>
            <p className="hidden min-w-0 flex-1 truncate text-sm text-subdued md:block">{song.album}</p>
            <button type="button" onClick={() => void addSongs(playlist, [song.id])} className="rounded-full border border-white/50 px-4 py-1.5 text-sm font-bold hover:scale-105 hover:border-white">
              Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
