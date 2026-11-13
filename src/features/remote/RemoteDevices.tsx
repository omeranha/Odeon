import clsx from 'clsx'
import { Car, Laptop, MonitorSpeaker, Smartphone } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { coverSongOf, type RemoteDevice } from '../../lib/remote'
import { SongCover } from '../library/cards'
import { useSendCommand, useTransferPlayback } from '../player/transport'
import { useActiveRemote, useSessionStore } from './session'

function DeviceIcon({ device, className }: { device: Pick<RemoteDevice, 'kind' | 'name'>; className?: string }) {
  if (device.kind === 'car') return <Car className={className} />
  if (/iPhone|Android|iPad/.test(device.name)) return <Smartphone className={className} />
  return <Laptop className={className} />
}

// The "devices" button in the players: lights up while playback runs on another device.
export function RemoteDevicesButton({ className }: { className?: string }) {
  const remote = useActiveRemote()
  const others = useSessionStore((state) => state.devices.filter((device) => device.online && device.id !== state.deviceId).length)
  const setPickerOpen = useSessionStore((state) => state.setPickerOpen)
  if (others === 0 && !remote) return null
  return (
    <button type="button" aria-label="Choose where to play" onClick={() => setPickerOpen(true)} className={clsx('relative transition hover:scale-105', remote ? 'text-accent' : 'text-subdued hover:text-white', className)}>
      <MonitorSpeaker className="size-4" />
      {remote && <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-accent" />}
    </button>
  )
}

export function DevicePicker() {
  const open = useSessionStore((state) => state.pickerOpen)
  const setPickerOpen = useSessionStore((state) => state.setPickerOpen)
  if (!open) return null
  return <DevicePickerDialog onClose={() => setPickerOpen(false)} />
}

function DevicePickerDialog({ onClose }: { onClose: () => void }) {
  const allDevices = useSessionStore((state) => state.devices)
  const deviceId = useSessionStore((state) => state.deviceId)
  const devices = allDevices.filter((device) => device.online && device.id !== deviceId)
  const remote = useActiveRemote()
  const transfer = useTransferPlayback()
  const send = useSendCommand()

  const choose = (target: RemoteDevice | 'here') => {
    transfer(target)
    onClose()
  }

  return (
    <Dialog title="Play on" onClose={onClose}>
      <ul className="flex flex-col gap-1">
        <li>
          <button type="button" onClick={() => choose('here')} className={clsx('flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-highlight', !remote && 'text-accent')}>
            <Laptop className="size-6 shrink-0" />
            <span className="min-w-0">
              <span className="block font-bold">This device</span>
              <span className="block truncate text-xs text-subdued">{remote ? 'Tap to move playback here' : 'Playing here'}</span>
            </span>
          </button>
        </li>
        {devices.map((device) => (
          <li key={device.id}>
            <button type="button" onClick={() => choose(device)} className={clsx('flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-highlight', device.id === remote?.id && 'text-accent')}>
              <DeviceIcon device={device} className="size-6 shrink-0" />
              <span className="min-w-0">
                <span className="block font-bold">{device.name}</span>
                <span className="block truncate text-xs text-subdued">{device.state?.song ? `${device.state.playing ? 'Playing' : 'Paused'}: ${device.state.song.title}` : 'Nothing playing'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {devices.length === 0 && <p className="mt-2 text-sm text-subdued">Open Odeon on another device with this account (another browser, your phone or the car tablet) and it shows up here.</p>}
      {remote?.state && remote.state.upcoming.length > 1 && (
        <div className="mt-5">
          <p className="mb-1 text-sm font-bold">Up next on {remote.name}</p>
          <ul className="flex flex-col">
            {remote.state.upcoming.slice(1, 40).map((song, index) => (
              <li key={`${song.id}-${index}`}>
                <button type="button" onClick={() => void send(remote, { type: 'jump', index: index + 1 })} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-highlight">
                  <SongCover song={coverSongOf(song)} size={80} className="size-9 shrink-0 rounded" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{song.title}</span>
                    <span className="block truncate text-xs text-subdued">{song.artist}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}

// Shown under the song in the players while another device plays.
export function PlayingOnLabel({ name }: { name: string }) {
  const setPickerOpen = useSessionStore((state) => state.setPickerOpen)
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        setPickerOpen(true)
      }}
      className="flex items-center gap-1 truncate text-xs text-accent hover:underline"
    >
      <MonitorSpeaker className="size-3 shrink-0" /> Playing on {name}
    </button>
  )
}
