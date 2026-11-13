import { ChevronDown, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { PlaylistImport } from '../../lib/downtify'
import { pluralize } from '../../lib/format'
import { useImportFailures, useRetryImport } from './imports'

export function ImportStatus({ entry, compact = false }: { entry: PlaylistImport; compact?: boolean }) {
  const { retry, retrying } = useRetryImport()
  const [showMissing, setShowMissing] = useState(false)
  const done = entry.added + entry.failed
  const percent = entry.total > 0 ? Math.round((done / entry.total) * 100) : 100
  const failures = useImportFailures(entry.id, showMissing && !entry.running, entry.failed)

  if (!entry.running && entry.failed === 0) return null

  return (
    <div className={compact ? '' : 'mx-4 mb-4 rounded-lg bg-white/5 p-4 md:mx-6'} role="status">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="font-bold">{entry.running ? 'Importing songs…' : `${pluralize(entry.failed, 'song')} couldn't be added`}</p>
        <p className="text-subdued tabular-nums">
          {entry.added} of {entry.total} added
          {entry.running && entry.failed > 0 && `, ${entry.failed} not found yet`}
        </p>
      </div>

      {entry.running ? (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-subdued">Songs you don't have yet are downloaded first. This keeps going if you close the app.</p>
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={retrying} onClick={() => void retry(entry)} className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
              <RotateCw className={retrying ? 'size-4 animate-spin' : 'size-4'} /> Retry missing songs
            </button>
            <button type="button" aria-expanded={showMissing} onClick={() => setShowMissing(!showMissing)} className="flex items-center gap-1 text-sm font-bold text-subdued hover:text-white">
              {showMissing ? 'Hide' : 'Show'} missing songs <ChevronDown className={showMissing ? 'size-4 rotate-180' : 'size-4'} />
            </button>
          </div>
          <p className="mt-2 text-xs text-subdued">Retrying searches again and tries other YouTube versions of each song.</p>
          {showMissing && (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {failures.isPending && <li className="text-subdued">Loading…</li>}
              {failures.data?.map((song, index) => (
                <li key={`${song.title}-${index}`} className="flex flex-col rounded bg-white/5 px-3 py-2 md:flex-row md:items-center md:justify-between md:gap-4">
                  <span className="min-w-0 truncate">
                    {song.title} <span className="text-subdued">• {song.artists.join(', ')}</span>
                  </span>
                  <span className="shrink-0 text-xs text-subdued">{song.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
