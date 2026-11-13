import { songQuality } from '../lib/songQuality'
import type { SubsonicSong } from '../lib/subsonic/types'

export function QualityBadge({ song, className = 'border-white/30 text-subdued' }: { song: SubsonicSong; className?: string }) {
  const quality = songQuality(song)
  if (!quality) return null
  return (
    <span title={quality.title} className={`shrink-0 rounded-sm border px-1 text-[10px] leading-4 font-bold tracking-wide whitespace-nowrap ${className}`}>
      {quality.label}
    </span>
  )
}
