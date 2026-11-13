import { LibraryPanel } from '../features/library/LibraryPanel'

export function Sidebar() {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col overflow-hidden rounded-lg bg-surface md:flex lg:w-[340px]">
      <LibraryPanel />
    </aside>
  )
}
