import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, libraryApi, storageApi, type DuplicateGroup, type StorageGroup, type StorageUsage } from '../../lib/downtify'
import { formatBytes, pluralize } from '../../lib/format'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const PERIODS = [7, 30, 90, 365] as const
const providerNames: Record<string, string> = { 'youtube-music': 'YouTube Music', youtube: 'YouTube', soundcloud: 'SoundCloud', slskd: 'Soulseek', folder: 'Extra folder', unknown: 'Unknown' }
const sourceName = (id: string) => providerNames[id] ?? id

// Downtify's own estimate keeps the biggest file of each group, which for lossless against lossy is the better one.
function defaultRemovals(group: DuplicateGroup): string[] {
  const keep = group.files.reduce((best, entry) => (entry.bytes > best.bytes ? entry : best), group.files[0])
  return group.files.filter((entry) => entry.file !== keep.file).map((entry) => entry.file)
}

export function StorageStats() {
  const credentials = credentialsOf(useCurrentProfile())
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const usage = useQuery({ queryKey: ['getMusic', 'storage', days], queryFn: () => storageApi.usage(credentials, days), staleTime: 60_000 })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIODS.map((period) => (
          <button key={period} type="button" aria-pressed={days === period} onClick={() => setDays(period)} className={clsx('rounded-full px-3 py-1 text-xs font-bold transition', days === period ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20')}>
            {period} days
          </button>
        ))}
        <button type="button" disabled={usage.isFetching} onClick={() => void usage.refetch()} className="ml-auto text-xs font-bold text-subdued hover:text-white hover:underline disabled:opacity-50">
          {usage.isFetching ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {usage.isPending ? (
        <p className="text-sm text-subdued">Loading…</p>
      ) : usage.isError ? (
        <p className="text-sm text-subdued">{usage.error instanceof DowntifyApiError ? usage.error.message : "Storage statistics aren't available right now."}</p>
      ) : (
        <>
          <Overview usage={usage.data} />
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <Breakdown title="By source" groups={usage.data.library.byProvider} nameOf={sourceName} total={usage.data.library.bytes} />
            <Breakdown title="By format" groups={usage.data.library.byFormat} nameOf={(id) => id.toUpperCase()} total={usage.data.library.bytes} />
          </div>
          <Duplicates usage={usage.data} onChanged={() => void usage.refetch()} />
          <Leftovers />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded bg-white/5 px-3 py-2">
      <p className="text-xs text-subdued">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {hint && <p className="text-xs text-subdued">{hint}</p>}
    </div>
  )
}

function Overview({ usage }: { usage: StorageUsage }) {
  const { library, period, downloads, disk, growth } = usage
  const net = growth.changeBytes
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Library" value={formatBytes(library.bytes)} hint={pluralize(library.files, 'song')} />
        <Stat label={`Added in ${usage.days} days`} value={formatBytes(period.bytes)} hint={pluralize(period.files, 'song')} />
        <Stat label="Net change" value={`${net >= 0 ? '+' : '-'}${formatBytes(Math.abs(net))}`} hint={growth.perDayBytes ? `${formatBytes(growth.perDayBytes)} a day` : undefined} />
        <Stat label="Free space" value={disk ? formatBytes(disk.free) : 'Unknown'} hint={disk?.daysLeft ? `about ${pluralize(disk.daysLeft, 'day')} left at this pace` : undefined} />
      </div>
      <p className="mt-3 text-sm text-subdued">
        Downloads in this period: {downloads.completed} finished, {downloads.skipped} skipped, {downloads.failed} failed.
      </p>
      <GrowthChart points={growth.points} />
    </>
  )
}

function GrowthChart({ points }: { points: StorageUsage['growth']['points'] }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((point) => point.bytes))
  const min = Math.min(...points.map((point) => point.bytes))
  const span = Math.max(1, max - min)
  const coordinates = points.map((point, index) => `${(index / (points.length - 1)) * 100},${36 - ((point.bytes - min) / span) * 32}`)
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Library size over time" className="mt-3 h-16 w-full text-accent">
      <polyline points={coordinates.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Breakdown({ title, groups, nameOf, total }: { title: string; groups: StorageGroup[]; nameOf: (id: string) => string; total: number }) {
  if (groups.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      <ul className="flex flex-col gap-2">
        {[...groups]
          .sort((a, b) => b.bytes - a.bytes)
          .map((group) => (
            <li key={group.id} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate">{nameOf(group.id)}</span>
                <span className="shrink-0 text-subdued">
                  {formatBytes(group.bytes)} · {pluralize(group.files, 'song')}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-accent" style={{ width: `${total > 0 ? Math.min(100, (group.bytes / total) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
      </ul>
    </div>
  )
}

function Duplicates({ usage, onChanged }: { usage: StorageUsage; onChanged: () => void }) {
  const credentials = credentialsOf(useCurrentProfile())
  const queryClient = useQueryClient()
  const { duplicates } = usage
  const initial = useMemo(() => new Set(duplicates.examples.flatMap(defaultRemovals)), [duplicates.examples])
  const [removals, setRemovals] = useState<Set<string>>(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const toggle = (file: string) =>
    setRemovals((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })

  async function remove() {
    setConfirming(false)
    setBusy(true)
    try {
      const result = await libraryApi.remove(credentials, [...removals])
      showToast(result.failed.length > 0 ? `Removed ${result.deleted}, ${result.failed.length} failed: ${result.failed[0].reason}` : `Deleted ${pluralize(result.deleted, 'song')}`)
      setRemovals(new Set())
      onChanged()
      if (result.deleted > 0) setTimeout(() => void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey[0] !== 'getMusic' && entry.queryKey[0] !== 'session' }), 8000)
    } catch (error) {
      showToast(error instanceof DowntifyApiError ? error.message : "The songs couldn't be removed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8">
      <h3 className="mb-1 text-sm font-bold">Duplicate songs</h3>
      {duplicates.groups === 0 ? (
        <p className="text-sm text-subdued">No duplicates found.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-subdued">
            {pluralize(duplicates.groups, 'group')} of the same song, {formatBytes(duplicates.bytes)} to free. The biggest file of each group is kept. "Likely" matches compare title, artist and length, not the audio, so check before removing.
            {duplicates.examples.length < duplicates.groups && ` Showing the ${duplicates.examples.length} that free the most.`}
          </p>
          <ul className="mb-3 flex max-h-96 flex-col gap-2 overflow-y-auto">
            {duplicates.examples.map((group) => (
              <li key={group.files[0].file} className="rounded bg-white/5 p-3 text-sm">
                <p className="truncate font-bold">
                  {group.title} <span className="font-normal text-subdued">{group.artist}</span>
                  {group.kind === 'likely' && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase">Likely</span>}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {group.files.map((entry) => (
                    <li key={entry.file}>
                      <label className="flex cursor-pointer items-center gap-3 text-xs">
                        <input type="checkbox" checked={removals.has(entry.file)} onChange={() => toggle(entry.file)} className="size-4 shrink-0 accent-accent" />
                        <span className="min-w-0 flex-1 truncate">{entry.file}</span>
                        <span className="shrink-0 text-subdued">
                          {sourceName(entry.provider)} · {entry.codec.toUpperCase()} · {formatBytes(entry.bytes)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy || removals.size === 0} onClick={() => setConfirming(true)} className={pillButton}>
            {busy ? 'Removing…' : removals.size === 0 ? 'Remove selected' : `Remove ${pluralize(removals.size, 'file')}`}
          </button>
        </>
      )}
      {confirming && <ConfirmDialog title={`Remove ${pluralize(removals.size, 'file')}?`} message="The selected copies are deleted from the server for good." confirmLabel="Remove" onConfirm={() => void remove()} onClose={() => setConfirming(false)} />}
    </div>
  )
}

function Leftovers() {
  const credentials = credentialsOf(useCurrentProfile())
  const [opened, setOpened] = useState(false)
  const scan = useQuery({ queryKey: ['getMusic', 'storageScan'], queryFn: () => storageApi.scan(credentials, false), enabled: opened, staleTime: 10 * 60_000 })

  return (
    <div className="mt-8">
      <h3 className="mb-1 text-sm font-bold">Folders and leftovers</h3>
      <p className="mb-3 text-sm text-subdued">What the download folders hold, plus partial downloads and orphaned lyrics or covers. Nothing here is deleted.</p>
      {!opened ? (
        <button type="button" onClick={() => setOpened(true)} className={pillButton}>
          Scan folders
        </button>
      ) : scan.isPending ? (
        <p className="text-sm text-subdued">Scanning… this can take a minute on a big library.</p>
      ) : scan.isError ? (
        <p className="text-sm text-subdued">{scan.error instanceof DowntifyApiError ? scan.error.message : "The scan isn't available right now."}</p>
      ) : (
        <>
          <ul className="mb-2 flex flex-col gap-1 text-sm">
            {scan.data.folders.map((folder) => (
              <li key={folder.id} className="flex justify-between gap-3">
                <span className="truncate">{folder.path}</span>
                <span className="shrink-0 text-subdued">
                  {formatBytes(folder.bytes)} · {pluralize(folder.files, 'file')}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-subdued">
            Leftover temporary files: {pluralize(scan.data.leftovers.files, 'file')} ({formatBytes(scan.data.leftovers.bytes)}). Orphaned lyrics and covers: {pluralize(scan.data.orphans.files, 'file')} ({formatBytes(scan.data.orphans.bytes)}).
          </p>
          <button type="button" disabled={scan.isFetching} onClick={() => void storageApi.scan(credentials, true).then(() => scan.refetch())} className={`${pillButton} mt-3`}>
            Scan again
          </button>
        </>
      )}
    </div>
  )
}
