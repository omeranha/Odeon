import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { LoadingState, MessageState } from '../components/PageState'
import { showToast } from '../components/toastStore'
import { formatListeningTime } from '../lib/format'
import { fromRemoteSong } from '../lib/remote'
import { useHistoryActions, useListeningUsage, useRecentPlays } from '../features/history/hooks'
import { RecentSearches } from '../features/history/RecentSearches'
import { useStarred } from '../features/library/queries'
import { TrackList } from '../features/library/TrackList'
import { credentialsOf, useCurrentProfile } from '../features/profiles/profileStore'

const source = { type: 'history' as const, name: 'History' }
const MONTHS_SHOWN = 12

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number)
  return new Date(year, number - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function HistoryPage() {
  return (
    <div className="pb-8">
      <h1 className="px-4 pt-6 pb-4 text-2xl font-bold md:px-6 md:pt-8 md:text-3xl">History</h1>
      <ListeningTime />
      <RecentlyPlayed />
      <RecentSearches />
    </div>
  )
}

function ListeningTime() {
  const { data, isPending, isError } = useListeningUsage()
  const thisMonth = currentMonth()
  const months = useMemo(() => {
    const listened = new Map((data?.months ?? []).map((entry) => [entry.month, entry.seconds]))
    listened.set(thisMonth, listened.get(thisMonth) ?? 0)
    return [...listened].map(([month, seconds]) => ({ month, seconds })).sort((a, b) => b.month.localeCompare(a.month)).slice(0, MONTHS_SHOWN)
  }, [data, thisMonth])
  const longest = Math.max(...months.map((entry) => entry.seconds), 1)

  return (
    <section className="mb-8 px-4 md:px-6">
      <h2 className="mb-3 text-xl font-bold md:text-2xl">Listening time</h2>
      {isPending ? (
        <LoadingState />
      ) : isError ? (
        <p className="text-sm text-subdued">Couldn't load your listening time.</p>
      ) : (
        <div className="rounded-lg bg-white/5 p-4">
          <p className="text-sm text-subdued">{monthLabel(thisMonth)}</p>
          <p className="mb-4 text-3xl font-bold">{formatListeningTime(months[0].seconds)}</p>
          <ul className="flex flex-col gap-2">
            {months.slice(1).map((entry) => (
              <li key={entry.month} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm">
                <span className="truncate text-subdued">{monthLabel(entry.month)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(entry.seconds / longest) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{formatListeningTime(entry.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function RecentlyPlayed() {
  const profile = useCurrentProfile()
  const { data, isPending, isError } = useRecentPlays()
  const { data: starred } = useStarred()
  const { clearPlays } = useHistoryActions()
  const [clearing, setClearing] = useState(false)

  const songs = useMemo(() => {
    const starredAt = new Map((starred?.song ?? []).map((song) => [song.id, song.starred]))
    return (data ?? []).map((entry) => ({ ...fromRemoteSong(entry.song, credentialsOf(profile)), starred: starredAt.get(entry.song.id) }))
  }, [data, starred, profile])

  async function handleClear() {
    setClearing(true)
    await clearPlays().catch(() => showToast("Couldn't clear your history. Try again."))
    setClearing(false)
  }

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3 px-4 md:px-6">
        <h2 className="text-xl font-bold md:text-2xl">Recently played</h2>
        {songs.length > 0 && (
          <button type="button" disabled={clearing} onClick={() => void handleClear()} className="text-sm font-bold text-subdued hover:text-white hover:underline disabled:opacity-50">
            Clear history
          </button>
        )}
      </div>
      {isPending ? (
        <LoadingState />
      ) : isError ? (
        <MessageState title="Couldn't load your history" message="Check your connection and try again." />
      ) : songs.length === 0 ? (
        <MessageState icon={<Clock className="size-12 text-subdued" />} title="Nothing played yet" message="Songs you listen to for at least 30 seconds show up here." />
      ) : (
        <TrackList songs={songs} source={source} showAlbum showCover showHeader={false} />
      )}
    </section>
  )
}
