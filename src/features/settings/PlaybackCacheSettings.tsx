import { showToast } from '../../components/toastStore'
import { formatBytes, pluralize } from '../../lib/format'
import { clearPlaybackCache, PLAYBACK_CACHE_LIMITS_MB, usePlaybackCacheStore } from '../player/playbackCache'

const limitLabel = (limitMb: number) => (limitMb === 0 ? 'Off' : formatBytes(limitMb * 1024 * 1024))

export function PlaybackCacheSettings() {
  const songs = usePlaybackCacheStore((state) => state.songs)
  const limitMb = usePlaybackCacheStore((state) => state.limitMb)
  const setLimitMb = usePlaybackCacheStore((state) => state.setLimitMb)
  const cached = Object.values(songs)
  const bytes = cached.reduce((sum, song) => sum + song.bytes, 0)

  async function handleClear() {
    await clearPlaybackCache()
    showToast('Played songs cleared from this device')
  }

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div>
        <p className="text-sm">Recently played songs</p>
        <p className="text-sm text-subdued">Songs you listen to are kept on this device, so playing them again starts at once and doesn't use the network. The least recently played are removed when the limit is reached.</p>
        <p className="text-sm text-subdued">
          {pluralize(cached.length, 'song')} using {formatBytes(bytes)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <select aria-label="Size limit for played songs" value={limitMb} onChange={(event) => setLimitMb(Number(event.target.value))} className="rounded bg-highlight px-3 py-2 text-base outline-none focus:ring-2 focus:ring-white md:text-sm">
          {PLAYBACK_CACHE_LIMITS_MB.map((limit) => (
            <option key={limit} value={limit}>
              {limitLabel(limit)}
            </option>
          ))}
        </select>
        <button type="button" disabled={cached.length === 0} onClick={() => void handleClear()} className="rounded-full border border-white/50 px-5 py-2 text-sm font-bold transition hover:scale-105 hover:border-white disabled:pointer-events-none disabled:opacity-40">
          Clear
        </button>
      </div>
    </div>
  )
}
