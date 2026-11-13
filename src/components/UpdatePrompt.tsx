import { useRegisterSW } from 'virtual:pwa-register/react'

// Updates wait for the user instead of reloading automatically, so playback is never cut off mid-song.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(8rem+var(--nav-inset))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-2xl md:bottom-24">
      <p className="flex-1 text-sm">A new version of Odeon is available.</p>
      <button type="button" onClick={() => setNeedRefresh(false)} className="text-sm text-subdued hover:text-white">
        Later
      </button>
      <button type="button" onClick={() => void updateServiceWorker()} className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black hover:scale-105">
        Reload
      </button>
    </div>
  )
}
