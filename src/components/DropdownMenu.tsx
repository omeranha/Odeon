import clsx from 'clsx'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
}

export type MenuEntry = MenuItem | false | null | undefined

interface OpenState {
  asSheet: boolean
  position: CSSProperties
}

const ITEM_HEIGHT = 44

export function DropdownMenu({ label, items, header, className }: { label: string; items: MenuEntry[]; header?: ReactNode; className?: string }) {
  const [openState, setOpenState] = useState<OpenState | null>(null)
  const visibleItems = items.filter((item): item is MenuItem => Boolean(item))

  function handleOpen(trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect()
    const estimatedHeight = visibleItems.length * ITEM_HEIGHT + 16
    const openUp = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight
    const position: CSSProperties = { right: Math.max(8, window.innerWidth - rect.right), ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) }
    setOpenState({ asSheet: window.matchMedia('(max-width: 47.99rem)').matches, position })
  }

  if (visibleItems.length === 0) return null

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={openState !== null}
        onClick={(event) => {
          event.stopPropagation()
          handleOpen(event.currentTarget)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={clsx('grid shrink-0 place-items-center text-subdued transition hover:text-white', className)}
      >
        <MoreHorizontal className="size-5" />
      </button>
      {openState && <MenuPopover state={openState} items={visibleItems} header={header} onClose={() => setOpenState(null)} />}
    </>
  )
}

function MenuPopover({ state, items, header, onClose }: { state: OpenState; items: MenuItem[]; header?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon
    return (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          item.onSelect()
        }}
        className={clsx('flex w-full items-center gap-3 text-left hover:bg-highlight', state.asSheet ? 'px-5 py-3.5 text-base' : 'rounded-sm px-3 py-2.5 text-sm')}
      >
        {Icon && <Icon className={clsx('shrink-0 text-subdued', state.asSheet ? 'size-6' : 'size-4')} />}
        {item.label}
      </button>
    )
  }

  // Portal events still bubble through the React tree, so stop them from reaching the row that owns the menu.
  return createPortal(
    <div className="fixed inset-0 z-[65]" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <div className={clsx('absolute inset-0', state.asSheet && 'bg-black/60')} onClick={onClose} />
      {state.asSheet ? (
        <div role="menu" className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-xl bg-elevated pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {header && <div className="border-b border-white/10 px-5 pt-2 pb-3">{header}</div>}
          {items.map(renderItem)}
        </div>
      ) : (
        <div role="menu" style={state.position} className="absolute w-60 rounded-md bg-elevated p-1 shadow-2xl shadow-black/60">
          {items.map(renderItem)}
        </div>
      )}
    </div>,
    document.body,
  )
}
