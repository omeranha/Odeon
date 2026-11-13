const prefetched = new Set<string>()

// A YouTube Music song takes a few seconds to get ready on the server the first time. Asking for it early, for the next
// song in the queue or the top search results, means it starts at once when played.
export function prefetchStream(streamUrl: string | undefined) {
  if (!streamUrl || !streamUrl.startsWith('/api/downtify/stream') || prefetched.has(streamUrl)) return
  if (prefetched.size >= 500) prefetched.clear()
  prefetched.add(streamUrl)
  void fetch(streamUrl.replace('/api/downtify/stream', '/api/downtify/prefetch'), { method: 'POST' })
    .then((response) => !response.ok && prefetched.delete(streamUrl))
    .catch(() => prefetched.delete(streamUrl))
}
