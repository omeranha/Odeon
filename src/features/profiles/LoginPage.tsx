import { ChevronLeft, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Logo } from '../../components/Logo'
import { AccountError, isPasskeyCancel, profileLoginOf, signInWithPasskey } from '../../lib/account'
import { useProfileStore } from './profileStore'

export const primaryButton = 'flex items-center justify-center gap-2 rounded-full bg-accent py-3.5 font-bold text-black transition hover:scale-[1.02] hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-60'

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const saveAndActivate = useProfileStore((state) => state.saveAndActivate)
  const hasProfiles = useProfileStore((state) => state.profiles.length > 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(searchParams.has('expired') ? 'Your session expired. Sign in again to continue.' : null)

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      saveAndActivate(profileLoginOf(await signInWithPasskey()))
      navigate('/', { replace: true })
    } catch (err) {
      if (!isPasskeyCancel(err)) setError(err instanceof AccountError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-elevated to-app px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {hasProfiles && (
        <Link to="/profiles" className="flex w-fit items-center gap-1 text-sm text-subdued hover:text-white">
          <ChevronLeft className="size-5" /> Profiles
        </Link>
      )}

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10">
        <div className="flex flex-col items-center gap-6 text-center">
          <Logo className="text-2xl" />
          <h1 className="text-3xl font-bold md:text-4xl">Log in to Odeon</h1>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-danger/15 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="button" disabled={busy} onClick={() => void signIn()} className={primaryButton}>
          <KeyRound className="size-5" /> {busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
        </button>

        <p className="text-center text-sm text-subdued">New here? Open the invite link the administrator sent you to create your passkey. Lost your passkey? Ask for a new invite link.</p>
      </main>
    </div>
  )
}
