import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { PINNED_COVER_CACHE, RUNTIME_COVER_CACHE } from './lib/offlineCaches'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/rest\//, /^\/auth\//, /^\/api\//] }))

const coverStrategy = new CacheFirst({
  cacheName: RUNTIME_COVER_CACHE,
  plugins: [new ExpirationPlugin({ maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true })],
})

registerRoute(
  ({ url }) => url.pathname === '/rest/getCoverArt' || url.pathname === '/rest/getCoverArt.view',
  async (options) => {
    const pinned = await (await caches.open(PINNED_COVER_CACHE)).match(options.request)
    return pinned ?? coverStrategy.handle(options)
  },
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
