import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { ExplicitBadge } from '../../components/ExplicitBadge'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, libraryApi, type LibraryFile } from '../../lib/downtify'
import { pluralize } from '../../lib/format'
import { useDebouncedValue } from '../../lib/hooks'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const listKey = ['getMusic', 'libraryFiles'] as const
const MAX_SELECTED = 2000
const VISIBLE_ROWS = 200
const LIBRARY_REFRESH_DELAY_MS = 8000

export function LibraryCleanup() {
  const credentials = credentialsOf(useCurrentProfile())
  const queryClient = useQueryClient()
  const [opened, setOpened] = useState(false)
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({ queryKey: listKey, queryFn: () => libraryApi.list(credentials), enabled: opened, staleTime: 0, gcTime: 0 })
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 200).trim().toLowerCase()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const matching = useMemo(() => (data ?? []).filter((track) => !term || `${track.title} ${track.artists.join(' ')} ${track.file}`.toLowerCase().includes(term)), [data, term])

  function toggle(file: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const allMatchingSelected = matching.length > 0 && matching.slice(0, MAX_SELECTED).every((track) => selected.has(track.file))
  const toggleAllMatching = () => setSelected(allMatchingSelected ? new Set() : new Set(matching.slice(0, MAX_SELECTED).map((track) => track.file)))

  async function remove() {
    setConfirming(false)
    setBusy(true)
    try {
      const result = await libraryApi.remove(credentials, [...selected])
      const gone = new Set([...selected].filter((file) => !result.failed.some((failure) => failure.file === file)))
      queryClient.setQueryData<LibraryFile[]>(listKey, (current) => current?.filter((track) => !gone.has(track.file)))
      setSelected(new Set(result.failed.map((failure) => failure.file)))
      showToast(result.failed.length > 0 ? `Deleted ${result.deleted}, ${result.failed.length} failed: ${result.failed[0].reason}` : `Deleted ${pluralize(result.deleted, 'song')}`)
      if (result.deleted > 0) {
        if (!result.scanStarted) showToast("Songs deleted, but Navidrome's rescan didn't start. Start a full scan in Navidrome.")
        setTimeout(() => void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey[0] !== 'getMusic' && entry.queryKey[0] !== 'session' }), LIBRARY_REFRESH_DELAY_MS)
      }
    } catch (err) {
      showToast(err instanceof DowntifyApiError ? err.message : "The songs couldn't be deleted")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-subdued">Every song in Downtify's download folder, which is what "Get music" fills and Navidrome reads. Deleting removes the files from the server for good, takes the songs out of playlists, and starts a Navidrome rescan. Songs saved for offline listening on devices stay there until removed.</p>

      {!opened ? (
        <button type="button" onClick={() => setOpened(true)} className={pillButton}>
          Show downloaded songs
        </button>
      ) : isPending ? (
        <p className="text-sm text-subdued">Loading…</p>
      ) : isError ? (
        <div>
          <p className="mb-3 text-sm text-subdued">{error instanceof DowntifyApiError ? error.message : "The list isn't available right now."}</p>
          <button type="button" onClick={() => void refetch()} className={pillButton}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${pluralize(data.length, 'song')}`} className="min-w-48 flex-1 rounded bg-elevated px-3 py-2 text-base outline-none placeholder:text-subdued focus:ring-2 focus:ring-white sm:text-sm" />
            <button type="button" disabled={matching.length === 0} onClick={toggleAllMatching} className="text-xs font-bold text-subdued hover:text-white hover:underline disabled:opacity-50">
              {allMatchingSelected ? 'Select none' : term ? `Select ${Math.min(matching.length, MAX_SELECTED)} matching` : `Select ${Math.min(matching.length, MAX_SELECTED)}`}
            </button>
          </div>

          {matching.length === 0 ? (
            <p className="py-4 text-sm text-subdued">{data.length === 0 ? 'No downloaded songs.' : 'No songs match your search.'}</p>
          ) : (
            <ul className="mb-3 flex max-h-96 flex-col gap-1 overflow-y-auto">
              {matching.slice(0, VISIBLE_ROWS).map((track) => (
                <li key={track.file}>
                  <label className="flex cursor-pointer items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    <input type="checkbox" checked={selected.has(track.file)} onChange={() => toggle(track.file)} className="size-4 shrink-0 accent-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {track.title}
                        {track.explicit && <ExplicitBadge />}
                        <span className="ml-2 text-subdued">{track.artists.join(', ')}</span>
                      </span>
                      <span className="block truncate text-xs text-subdued">{track.file}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {matching.length > VISIBLE_ROWS && <p className="mb-3 text-xs text-subdued">Showing the first {VISIBLE_ROWS} of {matching.length}. Search to narrow the list, or select all matching.</p>}
          {selected.size > MAX_SELECTED && <p className="mb-3 text-xs text-danger">Delete up to {MAX_SELECTED} songs at a time.</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || selected.size === 0 || selected.size > MAX_SELECTED} onClick={() => setConfirming(true)} className={pillButton}>
              {busy ? 'Deleting…' : selected.size === 0 ? 'Delete selected' : `Delete ${pluralize(selected.size, 'song')}`}
            </button>
            <button type="button" disabled={busy || isFetching} onClick={() => void refetch()} className={pillButton}>
              Reload list
            </button>
          </div>
        </>
      )}

      {confirming && <ConfirmDialog title={`Delete ${pluralize(selected.size, 'song')}?`} message="The files are deleted from the server for good. This can't be undone." confirmLabel="Delete" onConfirm={() => void remove()} onClose={() => setConfirming(false)} />}
    </div>
  )
}
