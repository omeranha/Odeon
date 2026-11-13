// Shared with the service worker, which serves pinned covers before its own runtime cache.
export const AUDIO_CACHE = 'spotydrome-audio'
export const PINNED_COVER_CACHE = 'spotydrome-offline-covers'
export const RUNTIME_COVER_CACHE = 'spotydrome-covers'

export const COVER_SIZES = [128, 300, 600] as const

export function coverSizeBucket(size: number): number {
  return COVER_SIZES.find((bucket) => size <= bucket) ?? COVER_SIZES[COVER_SIZES.length - 1]
}

export function audioCacheKey(songId: string): string {
  return `/offline/audio/${encodeURIComponent(songId)}`
}
