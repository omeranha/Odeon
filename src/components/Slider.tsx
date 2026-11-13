import clsx from 'clsx'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

interface SliderProps {
  value: number
  max: number
  label: string
  onCommit: (value: number) => void
  onPreview?: (value: number | null) => void
  valueText?: string
  step?: number
  disabled?: boolean
  className?: string
}

export function Slider({ value, max, label, onCommit, onPreview, valueText, step, disabled = false, className }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const shown = dragValue ?? value
  const percent = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0
  const inactive = disabled || max <= 0

  function valueAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * max
  }

  function updateDrag(next: number | null) {
    setDragValue(next)
    onPreview?.(next)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (inactive) return
    event.currentTarget.setPointerCapture(event.pointerId)
    updateDrag(valueAt(event.clientX))
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragValue === null) return
    const finalValue = valueAt(event.clientX)
    updateDrag(null)
    onCommit(finalValue)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (inactive) return
    const delta = step ?? max / 20
    const targets: Record<string, number> = { ArrowRight: shown + delta, ArrowUp: shown + delta, ArrowLeft: shown - delta, ArrowDown: shown - delta, Home: 0, End: max }
    if (!(event.key in targets)) return
    event.preventDefault()
    onCommit(Math.min(max, Math.max(0, targets[event.key])))
  }

  return (
    <div
      role="slider"
      tabIndex={inactive ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown * 100) / 100}
      aria-valuetext={valueText}
      aria-disabled={inactive}
      data-dragging={dragValue !== null ? '' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => dragValue !== null && updateDrag(valueAt(event.clientX))}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => updateDrag(null)}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      className={clsx('group/slider relative flex h-4 touch-none items-center outline-none', inactive ? 'pointer-events-none opacity-50' : 'cursor-pointer', className)}
    >
      <div ref={trackRef} className="h-1 w-full overflow-hidden rounded-full bg-white/30">
        <div className="h-full rounded-full bg-white group-hover/slider:bg-accent group-focus-visible/slider:bg-accent group-data-[dragging]/slider:bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <div className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow group-hover/slider:opacity-100 group-data-[dragging]/slider:opacity-100 max-md:opacity-100" style={{ left: `${percent}%` }} />
    </div>
  )
}
