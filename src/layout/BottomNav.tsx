import clsx from 'clsx'
import { House, Library, Search, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'

const tabs: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Your Library', icon: Library },
]

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/90 to-transparent pt-6 pb-[var(--nav-inset)] md:hidden">
      <ul className="flex h-14 items-center">
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink to={to} end={to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2 text-[11px]', isActive ? 'text-white' : 'text-subdued')}>
              {({ isActive }) => (
                <>
                  <Icon className="size-6" strokeWidth={isActive ? 2.5 : 2} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
