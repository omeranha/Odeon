import { LibraryPanel } from '../features/library/LibraryPanel'
import { ProfileMenu } from '../features/profiles/ProfileMenu'

export function LibraryPage() {
  return (
    <div className="flex min-h-full flex-col">
      <LibraryPanel
        leading={
          <div className="md:hidden">
            <ProfileMenu align="left" />
          </div>
        }
      />
    </div>
  )
}
