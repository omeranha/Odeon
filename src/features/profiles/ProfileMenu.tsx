import clsx from 'clsx'
import { CircleArrowDown, LogOut, Settings, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useGetMusicEnabled } from '../getMusic/hooks'
import { ProfileAvatar } from './ProfileAvatar'
import { useCurrentProfile, useProfileStore } from './profileStore'

export function ProfileMenu({ align = 'right' }: { align?: 'left' | 'right' }) {
  const profile = useCurrentProfile()
  const getMusicEnabled = useGetMusicEnabled()
  const deactivate = useProfileStore((state) => state.deactivate)
  const remove = useProfileStore((state) => state.remove)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const itemClass = 'flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm hover:bg-highlight'

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="rounded-full bg-black/60 p-1 transition hover:scale-105">
        <ProfileAvatar profile={profile} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className={clsx('absolute top-full z-50 mt-2 w-60 rounded-md bg-elevated p-1 shadow-2xl', align === 'right' ? 'right-0' : 'left-0')}>
            <div className="border-b border-white/10 px-3 py-2.5">
              <p className="truncate font-bold">{profile.displayName}</p>
              <p className="truncate text-xs text-subdued">@{profile.username}</p>
            </div>
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
              <Settings className="size-4" /> Settings
            </Link>
            {getMusicEnabled && (
              <Link to="/get-music" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
                <CircleArrowDown className="size-4" /> Get music
              </Link>
            )}
            <button type="button" role="menuitem" onClick={deactivate} className={itemClass}>
              <Users className="size-4" /> Switch profile
            </button>
            <button type="button" role="menuitem" onClick={() => remove(profile.id)} className={clsx(itemClass, 'border-t border-white/10')}>
              <LogOut className="size-4" /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
