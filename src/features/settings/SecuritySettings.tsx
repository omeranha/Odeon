import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldAlert, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/Dialog'
import { showToast } from '../../components/toastStore'
import { accountApi, adminApi, deviceName, isPasskeyCancel, messageFor, type AccountPasskey } from '../../lib/account'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { DeviceLink } from './DeviceLink'

const accountKey = ['account'] as const
export const pillButton = 'rounded-full border border-white/50 px-4 py-1.5 text-sm font-bold transition hover:scale-105 hover:border-white disabled:pointer-events-none disabled:opacity-50'

export function SecuritySettings() {
  const profile = useCurrentProfile()
  const credentials = credentialsOf(profile)
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({ queryKey: [...accountKey, profile.id], queryFn: () => accountApi.get(credentials) })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: accountKey })
  const [busy, setBusy] = useState(false)

  async function addPasskey() {
    setBusy(true)
    try {
      await accountApi.addPasskey(credentials, deviceName())
      showToast('Passkey added')
      refresh()
    } catch (error) {
      if (!isPasskeyCancel(error)) showToast(messageFor(error, "The passkey couldn't be added"))
    } finally {
      setBusy(false)
    }
  }

  if (isPending) return <p className="text-sm text-subdued">Loading…</p>
  if (isError || !data) return <p className="text-sm text-subdued">Sign-in options aren't available right now.</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold">
              <KeyRound className="size-4" /> Passkeys
            </p>
            <p className="text-sm text-subdued">Add a passkey on each device you use, so you can sign in if one is lost.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void addPasskey()} className={pillButton}>
            Add a passkey
          </button>
        </div>
        {data.passkeys.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {data.passkeys.map((passkey) => (
              <PasskeyRow key={passkey.id} passkey={passkey} onRemoved={refresh} />
            ))}
          </ul>
        )}
      </div>
      <DeviceLink />
      {profile.isAdmin && <AdminSecurity />}
    </div>
  )
}

function PasskeyRow({ passkey, onRemoved }: { passkey: AccountPasskey; onRemoved: () => void }) {
  const credentials = credentialsOf(useCurrentProfile())
  const [confirming, setConfirming] = useState(false)

  async function remove() {
    setConfirming(false)
    try {
      await accountApi.removePasskey(credentials, passkey.id)
      showToast('Passkey removed')
      onRemoved()
    } catch (error) {
      showToast(messageFor(error, "The passkey couldn't be removed"))
    }
  }

  return (
    <li className="flex items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{passkey.name}</span>
      <span className="hidden text-xs text-subdued sm:inline">{passkey.lastUsedAt ? `Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : `Added ${new Date(passkey.createdAt).toLocaleDateString()}`}</span>
      <button type="button" aria-label={`Remove ${passkey.name}`} onClick={() => setConfirming(true)} className="text-subdued hover:text-white">
        <Trash2 className="size-4" />
      </button>
      {confirming && <ConfirmDialog title="Remove passkey?" message={`You won't be able to sign in with "${passkey.name}" anymore.`} confirmLabel="Remove" onConfirm={() => void remove()} onClose={() => setConfirming(false)} />}
    </li>
  )
}

function AdminSecurity() {
  const credentials = credentialsOf(useCurrentProfile())
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: [...accountKey, 'security'], queryFn: () => adminApi.security(credentials), refetchInterval: 30_000 })
  if (!data) return null
  const bans = Object.entries(data.bans)

  async function unban(ip: string) {
    await adminApi.unban(credentials, ip).catch(() => showToast("Couldn't unblock"))
    void queryClient.invalidateQueries({ queryKey: [...accountKey, 'security'] })
  }

  return (
    <div className="border-t border-white/10 pt-6">
      <p className="mb-1 flex items-center gap-2 text-sm font-bold">
        <ShieldAlert className="size-4" /> Blocked addresses
      </p>
      <p className="mb-3 text-sm text-subdued">Addresses are blocked for 24 hours after 20 failed sign-ins in an hour, or when they scan for files like /.env or /wp-admin.</p>
      {bans.length === 0 ? (
        <p className="text-sm text-subdued">Nothing is blocked.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {bans.map(([ip, ban]) => (
            <li key={ip} className="flex items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm">
              <span className="font-mono">{ip}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-subdued">{ban.reason}, until {new Date(ban.until).toLocaleString()}</span>
              <button type="button" onClick={() => void unban(ip)} className="text-xs font-bold hover:underline">
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.events.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-subdued hover:text-white">Recent security events ({data.events.length})</summary>
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto font-mono text-xs text-subdued">
            {data.events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                {new Date(event.at).toLocaleString()} {event.kind} {event.ip} {event.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
