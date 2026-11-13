import clsx from 'clsx'
import { ChevronLeft, ChevronRight, House, Search } from 'lucide-react'
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router'
import { LogoMark } from '../components/Logo'
import { ProfileMenu } from '../features/profiles/ProfileMenu'

export function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const onSearchPage = location.pathname === '/search'
  const query = onSearchPage ? (searchParams.get('q') ?? '') : ''

  function handleSearchChange(value: string) {
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/search', { replace: onSearchPage })
  }

  return (
    <header className="hidden h-14 shrink-0 items-center justify-between gap-4 px-2 md:flex">
      <div className="flex items-center gap-3">
        <NavLink to="/" aria-label="Odeon home" className="text-white">
          <LogoMark className="size-8" />
        </NavLink>
        <div className="flex gap-2">
          <button type="button" aria-label="Go back" onClick={() => navigate(-1)} className="grid size-8 place-items-center rounded-full bg-black/60 text-subdued hover:text-white">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" aria-label="Go forward" onClick={() => navigate(1)} className="grid size-8 place-items-center rounded-full bg-black/60 text-subdued hover:text-white">
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      <div className="flex w-full max-w-[480px] items-center gap-2">
        <NavLink to="/" end aria-label="Home" className={({ isActive }) => clsx('grid size-12 shrink-0 place-items-center rounded-full bg-elevated transition hover:scale-105 hover:bg-highlight', isActive ? 'text-white' : 'text-subdued')}>
          {({ isActive }) => <House className="size-6" fill={isActive ? 'currentColor' : 'none'} />}
        </NavLink>
        <label className="group flex h-12 flex-1 items-center gap-3 rounded-full bg-elevated px-3 ring-white transition hover:bg-highlight focus-within:ring-2">
          <Search className="size-6 text-subdued group-focus-within:text-white" />
          <input type="search" value={query} onChange={(event) => handleSearchChange(event.target.value)} placeholder="What do you want to play?" className="w-full bg-transparent text-base outline-none placeholder:text-subdued" />
        </label>
      </div>

      <ProfileMenu />
    </header>
  )
}
