import clsx from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Logo } from '../../components/Logo'
import { ProfileAvatar } from './ProfileAvatar'
import { useProfileStore, type Profile } from './profileStore'

export function ProfilesPage() {
  const profiles = useProfileStore((state) => state.profiles)
  const activate = useProfileStore((state) => state.activate)
  const remove = useProfileStore((state) => state.remove)
  const navigate = useNavigate()
  const [managing, setManaging] = useState(false)

  if (profiles.length === 0) return <Navigate to="/login" replace />

  function handleSelect(profile: Profile) {
    if (!managing) {
      activate(profile.id)
      navigate('/', { replace: true })
      return
    }
    if (window.confirm(`Remove ${profile.username} from this device?`)) remove(profile.id)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-gradient-to-b from-elevated to-app px-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <Logo className="text-xl" />
      <h1 className="text-3xl font-bold md:text-4xl">Who's listening?</h1>

      <ul className="flex max-w-3xl flex-wrap justify-center gap-6 md:gap-8">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <button type="button" onClick={() => handleSelect(profile)} className="group flex w-28 flex-col items-center gap-3">
              <span className="relative rounded-full ring-white transition group-hover:ring-4">
                <ProfileAvatar profile={profile} size="xl" />
                {managing && (
                  <span className="absolute inset-0 grid place-items-center rounded-full bg-black/60">
                    <Trash2 className="size-8" />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-sm text-subdued group-hover:text-white">{profile.username}</span>
            </button>
          </li>
        ))}

        {!managing && (
          <li>
            <Link to="/login" className="group flex w-28 flex-col items-center gap-3">
              <span className="grid size-24 place-items-center rounded-full bg-highlight text-subdued transition group-hover:bg-white/20 group-hover:text-white md:size-28">
                <Plus className="size-10" />
              </span>
              <span className="text-sm text-subdued group-hover:text-white">Add account</span>
            </Link>
          </li>
        )}
      </ul>

      <button type="button" onClick={() => setManaging(!managing)} className={clsx('rounded-full border px-6 py-2 text-sm font-bold transition hover:scale-105', managing ? 'border-white bg-white text-black' : 'border-white/50 hover:border-white')}>
        {managing ? 'Done' : 'Manage profiles'}
      </button>
    </div>
  )
}
