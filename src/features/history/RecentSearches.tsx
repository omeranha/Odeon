import { Clock, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { showToast } from '../../components/toastStore'
import { useHistoryActions, useRecentSearches } from './hooks'

export function RecentSearches() {
  const { data: searches } = useRecentSearches()
  const actions = useHistoryActions()
  const navigate = useNavigate()
  if (!searches?.length) return null

  const run = (action: Promise<unknown>) => void action.catch(() => showToast("Couldn't update your search history. Try again."))

  return (
    <section className="px-4 md:px-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold md:text-2xl">Recent searches</h2>
        <button type="button" onClick={() => run(actions.clearSearches())} className="text-sm font-bold text-subdued hover:text-white hover:underline">
          Clear all
        </button>
      </div>
      <ul>
        {searches.map((entry) => (
          <li key={entry.query} className="flex items-center rounded-md hover:bg-white/10">
            <button type="button" onClick={() => navigate(`/search?q=${encodeURIComponent(entry.query)}`)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left">
              <Clock className="size-5 shrink-0 text-subdued" />
              <span className="truncate">{entry.query}</span>
            </button>
            <button type="button" aria-label={`Remove ${entry.query} from recent searches`} onClick={() => run(actions.removeSearch(entry.query))} className="grid size-9 shrink-0 place-items-center rounded-full text-subdued hover:text-white">
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
