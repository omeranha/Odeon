import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { ExplicitBadge } from '../../components/ExplicitBadge'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, explicitApi, type ExplicitRefreshStatus } from '../../lib/downtify'
import { pluralize } from '../../lib/format'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const statusKey = ['getMusic', 'explicit'] as const
const isRunning = (status?: ExplicitRefreshStatus) => status?.phase === 'scanning' || status?.phase === 'replacing'

export function ExplicitRefresh() {
  const credentials = credentialsOf(useCurrentProfile())
  const queryClient = useQueryClient()
  const { data, isPending, isError, error } = useQuery({ queryKey: statusKey, queryFn: () => explicitApi.status(credentials), refetchInterval: (query) => (isRunning(query.state.data) ? 3000 : false) })
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function act(action: () => Promise<ExplicitRefreshStatus | void>, fallback: string) {
    setBusy(true)
    try {
      const next = await action()
      if (next) queryClient.setQueryData(statusKey, next)
      else await queryClient.invalidateQueries({ queryKey: statusKey })
    } catch (err) {
      showToast(err instanceof DowntifyApiError ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  if (isPending) return <p className="text-sm text-subdued">Loading…</p>
  if (isError) return <p className="text-sm text-subdued">{error instanceof DowntifyApiError ? error.message : "This isn't available right now."}</p>

  const selected = data.found.filter((candidate) => !excluded.has(candidate.file))
  const toggle = (file: string) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  const scan = () => {
    setExcluded(new Set())
    void act(() => explicitApi.scan(credentials), "The check couldn't start")
  }
  const replace = () => {
    setConfirming(false)
    void act(() => explicitApi.replace(credentials, selected.map((candidate) => candidate.file)), "The songs couldn't be replaced")
  }

  return (
    <div>
      <p className="mb-3 text-sm text-subdued">Finds songs whose file is a clean edit although YouTube Music has the explicit version, and replaces their audio with it. Each file keeps its place in the library and in playlists, and gets the explicit tag. Lossless files are skipped.</p>
      {data.error && <p className="mb-3 rounded bg-danger/15 px-3 py-2 text-sm">{data.error}</p>}

      {data.phase === 'scanning' && (
        <div className="flex flex-wrap items-center gap-3">
          <Progress value={data.checked} total={data.total} label={data.total > 0 ? `Checked ${data.checked} of ${pluralize(data.total, 'song')}, ${data.found.length} found` : 'Reading the library…'} />
          <button type="button" disabled={busy} onClick={() => void act(() => explicitApi.cancel(credentials), "The check couldn't be stopped")} className={pillButton}>
            Stop
          </button>
        </div>
      )}

      {data.phase === 'replacing' && <Progress value={data.replace.done + data.replace.failed.length} total={data.replace.total} label={`Replacing songs: ${data.replace.done + data.replace.failed.length} of ${data.replace.total} finished`} />}

      {data.phase === 'done' && (
        <div className="mb-4 text-sm">
          <p className="font-bold">
            Replaced {data.replace.done} of {pluralize(data.replace.total, 'song')}.
          </p>
          {data.replace.done > 0 && <p className="text-subdued">Navidrome is rescanning the library, so the explicit tags show up in a few minutes. Songs saved for offline listening keep the old audio until you remove the download and download them again.</p>}
          {data.replace.failed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-subdued hover:text-white">{pluralize(data.replace.failed.length, 'song')} failed</summary>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-subdued">
                {data.replace.failed.map((failure, index) => (
                  <li key={`${failure.title}-${index}`}>
                    {failure.artist} – {failure.title}: {failure.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {(data.phase === 'scanned' || data.phase === 'done') && data.found.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{data.phase === 'done' ? `${pluralize(data.found.length, 'song')} still to replace` : `${pluralize(data.found.length, 'song')} found`}</p>
            <button type="button" onClick={() => setExcluded(selected.length === 0 ? new Set() : new Set(data.found.map((candidate) => candidate.file)))} className="text-xs font-bold text-subdued hover:text-white hover:underline">
              {selected.length === 0 ? 'Select all' : 'Select none'}
            </button>
          </div>
          <ul className="mb-3 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {data.found.map((candidate) => (
              <li key={candidate.file}>
                <label className="flex cursor-pointer items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                  <input type="checkbox" checked={!excluded.has(candidate.file)} onChange={() => toggle(candidate.file)} className="size-4 accent-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    {candidate.title}
                    <ExplicitBadge />
                    <span className="ml-2 text-subdued">{candidate.artist}</span>
                  </span>
                  <a href={`https://music.youtube.com/watch?v=${candidate.videoId}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="shrink-0 text-xs text-subdued hover:text-white hover:underline">
                    Listen
                  </a>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.phase === 'scanned' && data.found.length === 0 && <p className="mb-3 text-sm text-subdued">No clean copies found. Every song is already explicit, or YouTube Music has no explicit version of it.</p>}

      {!isRunning(data) && (
        <div className="flex flex-wrap gap-3">
          {data.found.length > 0 && (
            <button type="button" disabled={busy || selected.length === 0} onClick={() => setConfirming(true)} className={pillButton}>
              Replace {pluralize(selected.length, 'song')}
            </button>
          )}
          <button type="button" disabled={busy} onClick={scan} className={pillButton}>
            {data.phase === 'idle' ? 'Check library' : 'Check again'}
          </button>
        </div>
      )}

      {confirming && <ConfirmDialog title={`Replace ${pluralize(selected.length, 'song')}?`} message="Downtify downloads the explicit version of each song and replaces the audio of its file. This can't be undone from here." confirmLabel="Replace" onConfirm={replace} onClose={() => setConfirming(false)} />}
    </div>
  )
}

function Progress({ value, total, label }: { value: number; total: number; label: string }) {
  return (
    <div className="min-w-48 flex-1">
      <p className="mb-1 text-sm">{label}</p>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${total > 0 ? Math.min(100, (value / total) * 100) : 0}%` }} />
      </div>
    </div>
  )
}
