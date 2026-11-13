import { useState, type FormEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import type { SubsonicPlaylist } from '../../lib/subsonic/types'
import { usePlaylistMutations } from './mutations'

export function EditPlaylistDialog({ playlist, onClose }: { playlist: SubsonicPlaylist; onClose: () => void }) {
  const { updateDetails } = usePlaylistMutations()
  const [name, setName] = useState(playlist.name)
  const [comment, setComment] = useState(playlist.comment ?? '')
  const [isPublic, setIsPublic] = useState(Boolean(playlist.public))
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    const saved = await updateDetails(playlist.id, { name: name.trim(), comment: comment.trim(), public: isPublic })
    setSaving(false)
    if (saved) onClose()
  }

  const fieldClass = 'w-full rounded bg-highlight px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-white md:text-sm'

  return (
    <Dialog title="Edit details" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-bold text-subdued">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Add a name" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-bold text-subdued">
          Description
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} maxLength={300} placeholder="Add an optional description" className={`${fieldClass} resize-none`} />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="size-4 accent-accent" />
          Make public (visible to other users on this server)
        </label>
        <button type="submit" disabled={saving || !name.trim()} className="self-end rounded-full bg-white px-8 py-3 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Dialog>
  )
}
