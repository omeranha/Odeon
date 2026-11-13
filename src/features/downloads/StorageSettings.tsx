import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { formatBytes, pluralize } from '../../lib/format'
import { removeAllDownloads, useDownloadStore } from './downloadManager'

export function StorageSettings() {
  const songs = useDownloadStore((state) => state.songs)
  const downloadedCount = Object.values(songs).filter((song) => song.state === 'done').length
  const pendingCount = Object.values(songs).filter((song) => song.state === 'queued' || song.state === 'downloading').length
  const [estimate, setEstimate] = useState<{ usage: number; quota: number; persisted: boolean }>()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!navigator.storage?.estimate) return
      const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? Promise.resolve(false)])
      if (!cancelled) setEstimate({ usage, quota, persisted })
    })()
    return () => {
      cancelled = true
    }
  }, [downloadedCount])

  async function handleRemoveAll() {
    setConfirming(false)
    await removeAllDownloads()
    showToast('All downloads removed')
  }

  return (
    <>
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div>
          <p className="text-sm">
            {pluralize(downloadedCount, 'downloaded song')}
            {pendingCount > 0 && `, ${pendingCount} in progress`}
          </p>
          {estimate && (
            <p className="text-sm text-subdued">
              Using {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)} available to this app.{' '}
              {estimate.persisted ? 'Downloads are protected from automatic cleanup.' : 'The browser may clear downloads if the device runs low on space.'}
            </p>
          )}
        </div>
        <button type="button" disabled={downloadedCount + pendingCount === 0} onClick={() => setConfirming(true)} className="shrink-0 rounded-full border border-white/50 px-5 py-2 text-sm font-bold transition hover:scale-105 hover:border-white disabled:pointer-events-none disabled:opacity-40">
          Remove all downloads
        </button>
      </div>
      {confirming && <ConfirmDialog title="Remove all downloads?" message="Downloaded music will be deleted from this device. Your library on the server is not affected." confirmLabel="Remove" onConfirm={() => void handleRemoveAll()} onClose={() => setConfirming(false)} />}
    </>
  )
}
