import { MonitorSmartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AccountError, deviceLinkApi, deviceName, messageFor, type DeviceCodeStart, type SignInResult } from '../../lib/account'

// Shows a code that someone already signed in approves under Settings, Link a device, so a new device needs no invite link.
export function DeviceCodeSignIn({ onSignedIn }: { onSignedIn: (result: SignInResult) => void }) {
  const [code, setCode] = useState<DeviceCodeStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signedIn = useRef(onSignedIn)

  useEffect(() => {
    signedIn.current = onSignedIn
  }, [onSignedIn])

  useEffect(() => {
    if (!code) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll(current: DeviceCodeStart) {
      try {
        const result = await deviceLinkApi.poll(current.deviceCode)
        if (cancelled) return
        if ('status' in result) timer = setTimeout(() => void poll(current), current.interval * 1000)
        else signedIn.current(result)
      } catch (err) {
        if (cancelled) return
        if (err instanceof AccountError && err.status === 0) {
          timer = setTimeout(() => void poll(current), current.interval * 1000)
          return
        }
        setCode(null)
        setError(messageFor(err, 'The code stopped working. Get a new one.'))
      }
    }

    timer = setTimeout(() => void poll(code), code.interval * 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      setCode(await deviceLinkApi.start(deviceName()))
    } catch (err) {
      setError(messageFor(err, "Couldn't get a code. Try again."))
    } finally {
      setBusy(false)
    }
  }

  if (code) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-white/5 p-5 text-center">
        <p className="font-mono text-4xl font-bold tracking-widest">{code.userCode}</p>
        <p className="text-sm text-subdued">On a device where you're already signed in, open Settings, Sign-in and security, Link a device, and enter this code within 3 minutes. This screen continues by itself.</p>
        <button type="button" onClick={() => setCode(null)} className="text-sm font-bold text-subdued hover:text-white hover:underline">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <>
      {error && (
        <p role="alert" className="rounded-md bg-danger/15 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void start()} className="flex items-center justify-center gap-2 rounded-full border border-white/50 py-3 font-bold transition hover:scale-[1.02] hover:border-white disabled:pointer-events-none disabled:opacity-60">
        <MonitorSmartphone className="size-5" /> Sign in with a code
      </button>
    </>
  )
}
