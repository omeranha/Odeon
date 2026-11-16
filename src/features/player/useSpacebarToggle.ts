import { useEffect, useRef } from 'react'

const TEXT_ENTRY = 'input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]'
// Keys on an open menu or dialog belong to it.
const OWNS_SPACE = '[role="menu"], [role="dialog"], [role="listbox"]'

function shouldToggle(event: KeyboardEvent): boolean {
  if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false
  const target = event.target instanceof Element ? event.target : null
  return !target?.closest(TEXT_ENTRY) && !target?.closest(OWNS_SPACE)
}

// Space plays or pauses from anywhere in the app. On a focused button it would also press the button, so that is cancelled.
// Without a song to control, space is left alone so it still scrolls the page.
export function useSpacebarToggle(togglePlay: () => void, enabled: boolean) {
  const latest = useRef({ togglePlay, enabled })
  useEffect(() => {
    latest.current = { togglePlay, enabled }
  }, [togglePlay, enabled])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!latest.current.enabled || !shouldToggle(event)) return
      event.preventDefault()
      if (!event.repeat) latest.current.togglePlay()
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (latest.current.enabled && shouldToggle(event)) event.preventDefault()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])
}
