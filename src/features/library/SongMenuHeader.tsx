import type { SubsonicSong } from '../../lib/subsonic/types'
import { SongCover } from './cards'

export function SongMenuHeader({ song }: { song: SubsonicSong }) {
  return (
    <div className="flex items-center gap-3">
      <SongCover song={song} size={96} className="size-12 rounded" />
      <div className="min-w-0">
        <p className="truncate font-bold">{song.title}</p>
        <p className="truncate text-sm text-subdued">{song.artist}</p>
      </div>
    </div>
  )
}
