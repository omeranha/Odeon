import clsx from 'clsx'
import type { Profile } from './profileStore'

const avatarColors = ['bg-pink-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-rose-500']

const sizeClasses = {
  sm: 'size-8 text-sm',
  md: 'size-10 text-base',
  xl: 'size-24 text-4xl md:size-28',
}

function colorFor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return avatarColors[hash % avatarColors.length]
}

export function ProfileAvatar({ profile, size = 'sm' }: { profile: Profile; size?: keyof typeof sizeClasses }) {
  const classes = clsx('shrink-0 rounded-full', sizeClasses[size])
  if (profile.avatarUrl) return <img src={profile.avatarUrl} alt="" className={clsx(classes, 'object-cover')} />

  return <span className={clsx(classes, colorFor(profile.id), 'grid place-items-center font-bold text-black')}>{profile.displayName.charAt(0).toUpperCase()}</span>
}
