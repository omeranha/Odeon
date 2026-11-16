import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Logo } from '../../components/Logo'
import { AccountError, deviceName, inviteApi, isPasskeyCancel, profileLoginOf } from '../../lib/account'
import { primaryButton } from './LoginPage'
import { useProfileStore } from './profileStore'

export function InvitePage() {
  const token = useParams().token ?? ''
  const navigate = useNavigate()
  const saveAndActivate = useProfileStore((state) => state.saveAndActivate)
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => inviteApi.get(token), retry: false, staleTime: Infinity })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      saveAndActivate(profileLoginOf(await inviteApi.accept(token, deviceName())))
      navigate('/', { replace: true })
    } catch (err) {
      if (!isPasskeyCancel(err)) setError(err instanceof AccountError ? err.message : "The passkey couldn't be created. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-elevated to-app px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10 text-center">
        <Logo className="mx-auto text-2xl" />

        {invite.isPending && <p className="text-subdued">Checking your invite…</p>}

        {invite.isError && (
          <>
            <h1 className="text-3xl font-bold">Invite not valid</h1>
            <p className="text-subdued">{invite.error instanceof AccountError ? invite.error.message : "The server couldn't be reached. Try again."}</p>
            <Link to="/login" className="text-sm font-bold hover:underline">
              Go to sign in
            </Link>
          </>
        )}

        {invite.data && (
          <>
            <h1 className="text-3xl font-bold">Welcome, {invite.data.username}</h1>
            <p className="text-subdued">
              {invite.data.existingAccount ? 'Create a passkey on this device to sign in as ' : "You've been invited to Odeon as "}
              <span className="font-bold text-white">{invite.data.username}</span>. Your passkey uses this device's fingerprint, face or PIN, so there's no password to remember.
            </p>
            {error && (
              <p role="alert" className="rounded-md bg-danger/15 px-4 py-3 text-left text-sm text-danger">
                {error}
              </p>
            )}
            <button type="button" disabled={busy} onClick={() => void accept()} className={primaryButton}>
              <KeyRound className="size-5" /> {busy ? 'Waiting for your passkey…' : 'Create passkey'}
            </button>
            <p className="text-xs text-subdued">This link works once and expires on {new Date(invite.data.expiresAt).toLocaleString()}.</p>
          </>
        )}
      </main>
    </div>
  )
}
