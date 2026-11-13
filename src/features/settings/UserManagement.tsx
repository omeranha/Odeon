import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { adminApi, messageFor, type CreatedInvite, type ManagedUser } from '../../lib/account'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const usersKey = ['account', 'users'] as const

function statusOf(user: ManagedUser): string {
  const parts = []
  if (user.passkeys > 0) parts.push(user.passkeys === 1 ? '1 passkey' : `${user.passkeys} passkeys`)
  if (user.inviteExpiresAt) parts.push(`invite open until ${new Date(user.inviteExpiresAt).toLocaleString()}`)
  return parts.length > 0 ? parts.join(', ') : 'No access yet'
}

export function UserManagement() {
  const profile = useCurrentProfile()
  const credentials = credentialsOf(profile)
  const queryClient = useQueryClient()
  const { data, isPending, isError, error } = useQuery({ queryKey: usersKey, queryFn: () => adminApi.users(credentials) })
  const [invite, setInvite] = useState<CreatedInvite | null>(null)
  const [removing, setRemoving] = useState<ManagedUser | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: usersKey })

  async function createInvite(user: ManagedUser) {
    setBusyUser(user.username)
    try {
      setInvite(await adminApi.createInvite(credentials, user.username))
      refresh()
    } catch (err) {
      showToast(messageFor(err, "The invite couldn't be created"))
    } finally {
      setBusyUser(null)
    }
  }

  async function removeAccess(user: ManagedUser) {
    setRemoving(null)
    try {
      await adminApi.removeAccess(credentials, user.username)
      showToast(`Removed ${user.name}'s passkeys and invites`)
      refresh()
    } catch (err) {
      showToast(messageFor(err, "Access couldn't be removed"))
    }
  }

  if (isPending) return <p className="text-sm text-subdued">Loading…</p>
  if (isError) return <p className="text-sm text-subdued">{messageFor(error, "Users aren't available right now.")}</p>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-subdued">Add a user, then send them the invite link. Links work once and expire after 48 hours. To lock someone out completely, delete the user or change their password in Navidrome.</p>
        <button type="button" onClick={() => setAdding(true)} className={pillButton}>
          Add user
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {data.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">
                {user.name} <span className="font-normal text-subdued">@{user.username}</span>
                {user.isAdmin && <span className="ml-2 text-xs font-normal text-subdued">Administrator</span>}
              </p>
              <p className="truncate text-xs text-subdued">{statusOf(user)}</p>
            </div>
            <button type="button" disabled={busyUser === user.username} onClick={() => void createInvite(user)} className={pillButton}>
              {user.passkeys > 0 || user.inviteExpiresAt ? 'New invite' : 'Invite'}
            </button>
            {user.username.toLowerCase() !== profile.username.toLowerCase() && (user.passkeys > 0 || user.inviteExpiresAt) && (
              <button type="button" onClick={() => setRemoving(user)} className={pillButton}>
                Remove access
              </button>
            )}
          </li>
        ))}
      </ul>
      {invite && <InviteDialog invite={invite} onClose={() => setInvite(null)} />}
      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false)
            setInvite(created)
            refresh()
          }}
        />
      )}
      {removing && <ConfirmDialog title={`Remove ${removing.name}'s access?`} message="Their passkeys and open invites are deleted. Devices already signed in keep working until you change their password or delete them in Navidrome." confirmLabel="Remove access" onConfirm={() => void removeAccess(removing)} onClose={() => setRemoving(null)} />}
    </div>
  )
}

const inputClass = 'w-full rounded bg-highlight px-3 py-2 text-base outline-none focus:ring-2 focus:ring-white md:text-sm'

function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (invite: CreatedInvite) => void }) {
  const credentials = credentialsOf(useCurrentProfile())
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      onCreated(await adminApi.createUser(credentials, { username: username.trim(), name: name.trim(), isAdmin }))
    } catch (err) {
      showToast(messageFor(err, "The user couldn't be created"))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Add user" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={64} pattern="[\p{L}\p{N}._@\-]+" autoCapitalize="none" autoComplete="off" spellCheck={false} autoFocus className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={username || 'Shown in the app'} autoComplete="off" className={inputClass} />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} className="size-4 accent-accent" />
          Administrator
        </label>
        <p className="text-xs text-subdued">The user is created in Navidrome, and you get an invite link to send them.</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-subdued hover:scale-105 hover:text-white">
            Cancel
          </button>
          <button type="submit" disabled={busy || username.trim().length === 0} className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-black hover:scale-105 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
            Create
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function InviteDialog({ invite, onClose }: { invite: CreatedInvite; onClose: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link)
      showToast('Invite link copied')
    } catch {
      showToast('Select the link and copy it')
    }
  }

  return (
    <Dialog title={`Invite for ${invite.username}`} onClose={onClose}>
      <p className="mb-3 text-sm text-subdued">Send this link to {invite.username} privately. Anyone who opens it can create a passkey for this account. It works once, until {new Date(invite.expiresAt).toLocaleString()}.</p>
      <div className="flex gap-2">
        <input readOnly value={invite.link} onFocus={(event) => event.target.select()} className="min-w-0 flex-1 rounded bg-highlight px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-white" />
        <button type="button" onClick={() => void copy()} aria-label="Copy invite link" className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-black transition hover:scale-105">
          <Copy className="size-4" />
        </button>
      </div>
    </Dialog>
  )
}
