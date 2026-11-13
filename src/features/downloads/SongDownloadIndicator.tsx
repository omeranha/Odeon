import { CircleArrowDown } from 'lucide-react'
import { ProgressRing } from './DownloadButton'
import { useSongDownload } from './hooks'

export function SongDownloadIndicator({ songId }: { songId: string }) {
  const download = useSongDownload(songId)
  if (!download || download.state === 'error') return null
  if (download.state === 'done') return <CircleArrowDown className="size-3.5 shrink-0 text-accent" fill="currentColor" stroke="black" aria-label="Downloaded" />
  return <ProgressRing progress={download.progress} className="size-3.5 shrink-0 text-accent" />
}
