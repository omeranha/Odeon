import { useToastStore } from './toastStore'

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+var(--nav-inset))] z-[80] flex flex-col items-center gap-2 px-4 md:bottom-24">
      {toasts.map((toast) => (
        <div key={toast.id} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-2xl">
          {toast.message}
        </div>
      ))}
    </div>
  )
}
