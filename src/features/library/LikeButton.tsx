import clsx from 'clsx'
import { Heart } from 'lucide-react'
import type { StarKind } from '../../lib/subsonic/api'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useIsStarred, useToggleSongLike, useToggleStar } from './stars'

const iconSizes = { sm: 'size-4', md: 'size-5', lg: 'size-7' }

type LikeTarget = { kind: 'song'; item: SubsonicSong } | { kind: Exclude<StarKind, 'song'>; item: { id: string; starred?: string } }

export function LikeButton({ size = 'md', className, ...target }: LikeTarget & { size?: keyof typeof iconSizes; className?: string }) {
  const starred = useIsStarred(target.item)
  const toggleStar = useToggleStar()
  const toggleSongLike = useToggleSongLike()
  const label = target.kind === 'song' ? (starred ? 'Remove from Liked Songs' : 'Save to Liked Songs') : starred ? 'Remove from Your Library' : 'Save to Your Library'

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={starred}
      data-starred={starred}
      onClick={(event) => {
        event.stopPropagation()
        if (target.kind === 'song') void toggleSongLike(target.item, !starred)
        else void toggleStar(target.kind, target.item.id, !starred)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={clsx('shrink-0 transition hover:scale-105', starred ? 'text-accent' : 'text-subdued hover:text-white', className)}
    >
      <Heart className={iconSizes[size]} fill={starred ? 'currentColor' : 'none'} />
    </button>
  )
}
