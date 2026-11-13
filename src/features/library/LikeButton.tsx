import clsx from 'clsx'
import { Heart } from 'lucide-react'
import type { StarKind } from '../../lib/subsonic/api'
import { useIsStarred, useToggleStar } from './stars'

const iconSizes = { sm: 'size-4', md: 'size-5', lg: 'size-7' }

export function LikeButton({ kind, item, size = 'md', className }: { kind: StarKind; item: { id: string; starred?: string }; size?: keyof typeof iconSizes; className?: string }) {
  const starred = useIsStarred(item)
  const toggleStar = useToggleStar()
  const label = kind === 'song' ? (starred ? 'Remove from Liked Songs' : 'Save to Liked Songs') : starred ? 'Remove from Your Library' : 'Save to Your Library'

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={starred}
      data-starred={starred}
      onClick={(event) => {
        event.stopPropagation()
        void toggleStar(kind, item.id, !starred)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={clsx('shrink-0 transition hover:scale-105', starred ? 'text-accent' : 'text-subdued hover:text-white', className)}
    >
      <Heart className={iconSizes[size]} fill={starred ? 'currentColor' : 'none'} />
    </button>
  )
}
