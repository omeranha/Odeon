import { X } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onClick={(event) => event.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-lg bg-elevated shadow-2xl">
        <header className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
          <h2 id={titleId} className="text-2xl font-bold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-subdued hover:bg-highlight hover:text-white">
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-sm text-subdued">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-subdued hover:scale-105 hover:text-white">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-black hover:scale-105 hover:bg-accent-hover">
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
