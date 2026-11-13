import clsx from 'clsx'
import { CircleArrowDown } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { removeCollection, saveCollection } from './downloadManager'
import { useCollectionDownload, useDownloadContext } from './hooks'
import { collectionKey, type CollectionType, type OfflineCollection } from './offlineDb'

interface DownloadButtonProps {
  type: CollectionType
  id: string
  name: string
  coverArt?: string
  songs: SubsonicSong[]
  snapshot: OfflineCollection['snapshot']
}

export function DownloadButton({ type, id, name, coverArt, songs, snapshot }: DownloadButtonProps) {
  const status = useCollectionDownload(type, id)
  const context = useDownloadContext()
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const label = status.saved ? `Remove download of ${name}` : `Download ${name}`

  async function handleDownload() {
    await saveCollection({ type, id, name, coverArt, songs, snapshot }, context)
    showToast(`Downloading ${name}`)
  }

  async function handleRemove() {
    setConfirmingRemove(false)
    await removeCollection(collectionKey(type, id))
    showToast('Removed from your downloads')
  }

  return (
    <>
      <button type="button" aria-label={label} aria-pressed={status.saved} onClick={() => (status.saved ? setConfirmingRemove(true) : void handleDownload())} className={clsx('relative grid size-8 place-items-center transition hover:scale-105', status.saved ? 'text-accent' : 'text-subdued hover:text-white')}>
        {status.state === 'downloading' ? <ProgressRing progress={status.progress} /> : <CircleArrowDown className="size-8" strokeWidth={1.75} fill={status.state === 'done' ? 'currentColor' : 'none'} stroke={status.state === 'done' ? 'black' : 'currentColor'} />}
      </button>
      {confirmingRemove && <ConfirmDialog title="Remove from Downloads?" message={`You won't be able to play ${name} offline.`} confirmLabel="Remove" onConfirm={() => void handleRemove()} onClose={() => setConfirmingRemove(false)} />}
    </>
  )
}

export function ProgressRing({ progress, className = 'size-7' }: { progress: number; className?: string }) {
  const circumference = 2 * Math.PI * 10
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={`Downloading, ${Math.round(progress * 100)}%`}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(progress, 0.03))} transform="rotate(-90 12 12)" />
    </svg>
  )
}
