import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, qualityApi, type UpgradeStatus } from '../../lib/downtify'
import { formatBytes, pluralize } from '../../lib/format'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const statusKey = ['getMusic', 'quality'] as const
const CHECK_PER_RUN = 20
const isRunning = (status?: UpgradeStatus) => status?.phase === 'scanning' || status?.phase === 'applying'

export function QualityUpgrade() {
  const credentials = credentialsOf(useCurrentProfile())
  const queryClient = useQueryClient()
  const { data, isPending, isError, error } = useQuery({ queryKey: statusKey, queryFn: () => qualityApi.status(credentials), retry: false, refetchInterval: (query) => (isRunning(query.state.data) ? 3000 : false) })
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function act(action: () => Promise<UpgradeStatus | void>, fallback: string) {
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

  const selected = data.found.filter((item) => !excluded.has(item.file))
  const toggle = (file: string) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })

  return (
    <div>
      <p className="mb-3 text-sm text-subdued">
        Songs downloaded from YouTube Music are about 130 kbps. {data.auto.everyMinutes > 0 ? `Every ${data.auto.everyMinutes === 60 ? 'hour' : `${data.auto.everyMinutes} minutes`} the server looks` : 'This looks'} for a lossless copy of the same recording on Soulseek, checks by audio fingerprint that it is the same song and version (a clean edit does not pass), and replaces the audio with a 256 kbps AAC copy{data.auto.everyMinutes > 0 ? ', with no confirmation needed' : ''}. The file keeps its name, tags, lyrics and cover art, so likes and playlists stay. The old file is kept in the server's data folder.{data.auto.everyMinutes > 0 ? ' Devices replace their offline copies the next time the app opens.' : ''}
      </p>
      {data.auto.lastRunAt && <p className="mb-3 text-sm text-subdued">Last automatic run: {new Date(data.auto.lastRunAt).toLocaleString()}.</p>}
      {data.error && <p className="mb-3 rounded bg-danger/15 px-3 py-2 text-sm">{data.error}</p>}
      {data.upgradedEver > 0 && <p className="mb-3 text-sm text-subdued">{pluralize(data.upgradedEver, 'song')} upgraded so far.</p>}

      {data.phase === 'scanning' && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <p className="mb-1 text-sm">
              Checked {data.checked} of {data.total}, {data.found.length} found{data.current ? `. Now: ${data.current}` : ''}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${data.total > 0 ? Math.min(100, (data.checked / data.total) * 100) : 0}%` }} />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void act(() => qualityApi.cancel(credentials), "The check couldn't be stopped")} className={pillButton}>
            Stop
          </button>
        </div>
      )}

      {data.phase === 'applying' && (
        <p className="mb-3 text-sm">
          Converting: {data.apply.done + data.apply.failed.length} of {data.apply.total} finished
        </p>
      )}

      {data.phase === 'done' && (
        <div className="mb-3 text-sm">
          <p className="font-bold">
            Upgraded {data.apply.done} of {pluralize(data.apply.total, 'song')}.
          </p>
          {data.apply.done > 0 && <p className="text-subdued">Navidrome is rescanning, so the new quality shows up in a few minutes. Offline copies on your devices are replaced the next time the app opens.</p>}
          {data.apply.failed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-subdued">
              {data.apply.failed.map((failure, index) => (
                <li key={`${failure.title}-${index}`}>
                  {failure.artist} – {failure.title}: {failure.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.found.length > 0 && !isRunning(data) && (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm">{pluralize(data.found.length, 'verified copy')} ready</p>
            <button type="button" onClick={() => setExcluded(selected.length === 0 ? new Set() : new Set(data.found.map((item) => item.file)))} className="text-xs font-bold text-subdued hover:text-white hover:underline">
              {selected.length === 0 ? 'Select all' : 'Select none'}
            </button>
          </div>
          <ul className="mb-3 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {data.found.map((item) => (
              <li key={item.file}>
                <label className="flex cursor-pointer items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                  <input type="checkbox" checked={!excluded.has(item.file)} onChange={() => toggle(item.file)} className="size-4 shrink-0 accent-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    {item.title}
                    <span className="ml-2 text-subdued">{item.artist}</span>
                  </span>
                  <span className="shrink-0 text-xs text-subdued">
                    {Math.round(item.similarity * 100)}% match · {formatBytes(item.sizeBytes)} FLAC
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {!isRunning(data) && (
        <div className="flex flex-wrap gap-3">
          {data.found.length > 0 && (
            <button type="button" disabled={busy || selected.length === 0} onClick={() => setConfirming(true)} className={pillButton}>
              Upgrade {pluralize(selected.length, 'song')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setExcluded(new Set())
              void act(() => qualityApi.scan(credentials, CHECK_PER_RUN), "The check couldn't start")
            }}
            className={pillButton}
          >
            {data.phase === 'idle' ? `Check ${CHECK_PER_RUN} songs` : `Check ${CHECK_PER_RUN} more`}
          </button>
          {data.found.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void act(() => qualityApi.discard(credentials), "The copies couldn't be discarded")} className={pillButton}>
              Discard
            </button>
          )}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Upgrade ${pluralize(selected.length, 'song')}?`}
          message="Each file's audio is replaced with a 256 kbps AAC copy of the lossless version. The old file is kept on the server."
          confirmLabel="Upgrade"
          onConfirm={() => {
            setConfirming(false)
            void act(() => qualityApi.apply(credentials, selected.map((item) => item.file)), "The songs couldn't be upgraded")
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
