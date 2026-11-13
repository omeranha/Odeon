import { MonitorSmartphone } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { showToast } from '../../components/toastStore'
import { deviceLinkApi, messageFor } from '../../lib/account'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { pillButton } from './SecuritySettings'

const inputClass = 'w-40 rounded bg-highlight px-3 py-2 font-mono text-base tracking-widest uppercase outline-none focus:ring-2 focus:ring-white md:text-sm'

export function DeviceLink() {
  const credentials = credentialsOf(useCurrentProfile())
  const [code, setCode] = useState('')
  const [device, setDevice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function step(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast(messageFor(error, fallback))
    } finally {
      setBusy(false)
    }
  }

  const check = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void step(async () => setDevice((await deviceLinkApi.check(credentials, code.trim())).deviceName), "That code couldn't be checked")
  }

  const approve = () =>
    void step(async () => {
      const result = await deviceLinkApi.approve(credentials, code.trim())
      showToast(`${result.deviceName} is signed in as ${result.username}`)
      setDevice(null)
      setCode('')
    }, "The device couldn't be signed in")

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-bold">
        <MonitorSmartphone className="size-4" /> Link a device
      </p>
      <p className="mb-3 text-sm text-subdued">For devices without passkeys, like the car tablet. Enter the code it shows to sign it in to your account.</p>
      {device ? (
        <div className="flex flex-wrap items-center gap-3 rounded bg-white/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Sign in <span className="font-bold">{device}</span> as you? Only do this for a device you're holding or can see.
          </span>
          <button type="button" disabled={busy} onClick={approve} className={pillButton}>
            Sign it in
          </button>
          <button type="button" disabled={busy} onClick={() => setDevice(null)} className="text-sm text-subdued hover:text-white">
            Cancel
          </button>
        </div>
      ) : (
        <form onSubmit={check} className="flex gap-2">
          <input value={code} onChange={(event) => setCode(event.target.value.slice(0, 9))} placeholder="ABCD-2345" autoCapitalize="characters" autoComplete="off" spellCheck={false} required className={inputClass} />
          <button type="submit" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length !== 8} className={pillButton}>
            Continue
          </button>
        </form>
      )}
    </div>
  )
}
