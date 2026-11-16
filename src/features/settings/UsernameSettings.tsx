import { useState, type FormEvent } from 'react'
import { showToast } from '../../components/toastStore'
import { accountApi, messageFor } from '../../lib/account'
import { usePlayerStore } from '../player/playerStore'
import { credentialsOf, useCurrentProfile, useProfileStore } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const inputClass = 'w-full rounded bg-highlight px-3 py-2 text-base outline-none focus:ring-2 focus:ring-white md:text-sm'

export function UsernameSettings() {
  const profile = useCurrentProfile()
  const rename = useProfileStore((state) => state.rename)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(profile.username)
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = value.trim()
    if (next === profile.username) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      const renamed = await accountApi.rename(credentialsOf(profile), next)
      rename(profile.id, renamed.username)
      // Songs streamed from YouTube Music carry the old name in their links.
      usePlayerStore.getState().clear()
      showToast('Username changed. Sign in again on your other devices.')
      setEditing(false)
    } catch (error) {
      showToast(messageFor(error, "The username couldn't be changed"))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{profile.username}</p>
          {profile.isAdmin && <p className="text-sm text-subdued">Administrator</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setValue(profile.username)
            setEditing(true)
          }}
          className={pillButton}
        >
          Change username
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex min-w-0 flex-1 flex-col gap-2">
      <input value={value} onChange={(event) => setValue(event.target.value)} required maxLength={64} pattern="[\p{L}\p{N}._@\-]+" autoCapitalize="none" autoComplete="off" spellCheck={false} autoFocus aria-label="Username" className={inputClass} />
      <p className="text-xs text-subdued">Letters, numbers, dots, dashes, underscores and @. Your other devices will need to sign in again, and playback here stops.</p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || value.trim().length === 0} className={pillButton}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="text-sm text-subdued hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  )
}
