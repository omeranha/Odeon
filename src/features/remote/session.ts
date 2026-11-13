import { useEffect } from 'react'
import { create } from 'zustand'
import { fromRemoteSong, remoteApi, toRemoteSong, type RemoteCommand, type RemoteDevice, type ReportedState } from '../../lib/remote'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import { useCredentials } from '../library/queries'
import { previousOrRestart, seekTo, setStartPosition } from '../player/audioEngine'
import { usePlayerStore } from '../player/playerStore'
import { useProgressStore } from '../player/progressStore'

const REPORT_DELAY_MS = 500
const HEARTBEAT_MS = 15_000
const DEVICES_MS = 5_000
const DEVICES_OPEN_MS = 2_000
const MAX_UPCOMING = 200
// Playback moves the position about a quarter second per update; a bigger jump is a seek or a resumed song.
const POSITION_JUMP_SECONDS = 3

// Per tab, so two tabs of one browser are two devices instead of fighting over one id.
function tabDeviceId(): string {
  const key = 'spotydrome-device-id'
  let id = sessionStorage.getItem(key)
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(key, id)
  }
  return id
}

function deviceName(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser'
  const system = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Mac/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : ''
  return system ? `${browser} on ${system}` : browser
}

interface SessionState {
  deviceId: string
  devices: RemoteDevice[]
  fetchedAt: number
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  patchDevice: (id: string, change: (device: RemoteDevice) => RemoteDevice) => void
}

export const useSessionStore = create<SessionState>()((set) => ({
  deviceId: tabDeviceId(),
  devices: [],
  fetchedAt: 0,
  pickerOpen: false,
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
  patchDevice: (id, change) => set((state) => ({ devices: state.devices.map((device) => (device.id === id ? change(device) : device)) })),
}))

// The device whose playback this one shows and controls, when it isn't this one.
export function useActiveRemote(): RemoteDevice | undefined {
  return useSessionStore((state) => state.devices.find((device) => device.active && device.id !== state.deviceId && device.online && device.state?.song))
}

function reportedState(): ReportedState {
  const { queue, currentIndex, isPlaying, shuffle, repeat } = usePlayerStore.getState()
  const { position, duration } = useProgressStore.getState()
  const song = queue[currentIndex]
  return {
    song: song ? toRemoteSong(song) : null,
    playing: Boolean(song) && isPlaying,
    positionMs: Math.round(position * 1000),
    durationMs: Math.round((duration || song?.duration || 0) * 1000),
    shuffle,
    repeat,
    upcoming: queue.slice(currentIndex, currentIndex + MAX_UPCOMING).map(toRemoteSong),
  }
}

export function applyCommand(command: RemoteCommand, credentials: SubsonicCredentials) {
  const player = usePlayerStore.getState()
  switch (command.type) {
    case 'toggle':
      player.togglePlay()
      break
    case 'play':
      player.setPlaying(true)
      break
    case 'pause':
      player.setPlaying(false)
      break
    case 'next':
      player.next()
      break
    case 'previous':
      previousOrRestart()
      break
    case 'seek':
      seekTo(command.positionMs / 1000)
      break
    case 'jump':
      player.jumpTo(player.currentIndex + command.index)
      break
    case 'shuffle':
      player.toggleShuffle()
      break
    case 'repeat':
      player.cycleRepeat()
      break
    case 'playQueue':
    case 'transfer': {
      const songs = command.songs.map((song) => fromRemoteSong(song, credentials))
      if (songs.length === 0) break
      // Without the shuffle being re-applied, the queue arrives in the order the other device was playing it.
      if (player.shuffle) usePlayerStore.setState({ shuffle: false, smartShuffle: false })
      setStartPosition((command.positionMs ?? 0) / 1000)
      player.playQueue(songs, command.startIndex, null)
      if (command.playing === false) usePlayerStore.getState().setPlaying(false)
      break
    }
  }
}

// Keeps this tab in the account's playback session for as long as the app is open.
export function useRemoteSession() {
  const { username, token, salt } = useCredentials()

  useEffect(() => {
    const credentials = { username, token, salt }
    const { deviceId } = useSessionStore.getState()
    const name = deviceName()
    let stopped = false
    let reportTimer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const report = () => {
      if (stopped) return
      void remoteApi.report(credentials, deviceId, name, reportedState()).catch(() => undefined)
    }
    const scheduleReport = () => {
      clearTimeout(reportTimer)
      reportTimer = setTimeout(report, REPORT_DELAY_MS)
    }

    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      if (state.isPlaying !== previous.isPlaying || state.playbackId !== previous.playbackId || state.queue !== previous.queue || state.shuffle !== previous.shuffle || state.repeat !== previous.repeat) scheduleReport()
    })
    const unsubscribeProgress = useProgressStore.subscribe((state, previous) => {
      if (Math.abs(state.position - previous.position) > POSITION_JUMP_SECONDS) scheduleReport()
    })
    const heartbeat = setInterval(() => usePlayerStore.getState().isPlaying && report(), HEARTBEAT_MS)
    report()

    const poll = async () => {
      let backoff = 2000
      while (!stopped) {
        try {
          const { commands } = await remoteApi.poll(credentials, deviceId, controller.signal)
          backoff = 2000
          for (const command of commands) applyCommand(command, credentials)
          if (commands.length > 0) scheduleReport()
        } catch {
          if (stopped) return
          await new Promise((resolve) => setTimeout(resolve, backoff))
          backoff = Math.min(backoff * 2, 60_000)
        }
      }
    }
    void poll()

    let devicesTimer: ReturnType<typeof setTimeout> | undefined
    const refreshDevices = async () => {
      try {
        const devices = await remoteApi.devices(credentials)
        if (!stopped) useSessionStore.setState({ devices, fetchedAt: Date.now() })
      } catch {
        // Kept from the last successful fetch.
      }
      if (!stopped) devicesTimer = setTimeout(() => void refreshDevices(), useSessionStore.getState().pickerOpen ? DEVICES_OPEN_MS : DEVICES_MS)
    }
    void refreshDevices()
    const refreshNow = () => {
      clearTimeout(devicesTimer)
      void refreshDevices()
    }
    const unsubscribeSession = useSessionStore.subscribe((state, previous) => {
      if (state.pickerOpen && !previous.pickerOpen) refreshNow()
    })

    const leave = () => void remoteApi.leave(credentials, deviceId).catch(() => undefined)
    window.addEventListener('pagehide', leave)

    return () => {
      stopped = true
      controller.abort()
      clearTimeout(reportTimer)
      clearTimeout(devicesTimer)
      clearInterval(heartbeat)
      unsubscribePlayer()
      unsubscribeProgress()
      unsubscribeSession()
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [username, token, salt])
}
