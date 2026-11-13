import { useEffect, useState } from 'react'
import { showToast } from '../../components/toastStore'
import { coverSongOf, fromRemoteSong, remoteApi, toRemoteSong, type RemoteCommand, type RemoteDevice } from '../../lib/remote'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useCredentials } from '../library/queries'
import { useActiveRemote, useSessionStore } from '../remote/session'
import { previousOrRestart, seekTo, setStartPosition } from './audioEngine'
import { usePlayerStore, type RepeatMode } from './playerStore'
import { useProgressStore } from './progressStore'

// The player controls act on whichever device plays for this account: this one, or another (the car, a phone).
export interface Transport {
  song: SubsonicSong | undefined
  isPlaying: boolean
  position: number
  duration: number
  shuffle: boolean
  smartShuffle: boolean
  repeat: RepeatMode
  remoteName: string | null
  togglePlay: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function remotePosition(device: RemoteDevice, fetchedAt: number, now: number): number {
  const state = device.state
  if (!state) return 0
  const elapsed = state.playing ? state.ageMs + Math.max(0, now - fetchedAt) : 0
  return Math.min(state.durationMs, state.positionMs + elapsed) / 1000
}

export function useSendCommand() {
  const credentials = useCredentials()
  return (device: RemoteDevice, command: RemoteCommand) =>
    remoteApi.send(credentials, device.id, command).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "The other device didn't respond")
    })
}

export function useTransport(): Transport {
  const remote = useActiveRemote()
  const fetchedAt = useSessionStore((state) => state.fetchedAt)
  const patchDevice = useSessionStore((state) => state.patchDevice)
  const send = useSendCommand()
  const now = useNow(Boolean(remote?.state?.playing))

  const localSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const localPlaying = usePlayerStore((state) => state.isPlaying)
  const localShuffle = usePlayerStore((state) => state.shuffle)
  const localSmartShuffle = usePlayerStore((state) => state.smartShuffle)
  const localRepeat = usePlayerStore((state) => state.repeat)
  const localPosition = useProgressStore((state) => state.position)
  const localDuration = useProgressStore((state) => state.duration)

  if (remote?.state?.song) {
    const state = remote.state
    const command = (next: RemoteCommand, optimistic?: Partial<typeof state>) => {
      if (optimistic) patchDevice(remote.id, (device) => ({ ...device, state: device.state && { ...device.state, ...optimistic } }))
      void send(remote, next)
    }
    return {
      song: coverSongOf(state.song!),
      isPlaying: state.playing,
      position: remotePosition(remote, fetchedAt, now),
      duration: state.durationMs / 1000,
      shuffle: state.shuffle,
      // Other devices only report plain shuffle, so their button toggles it on and off.
      smartShuffle: false,
      repeat: state.repeat,
      remoteName: remote.name,
      togglePlay: () => command({ type: state.playing ? 'pause' : 'play' }, { playing: !state.playing }),
      next: () => command({ type: 'next' }),
      previous: () => command({ type: 'previous' }),
      seek: (seconds) => command({ type: 'seek', positionMs: Math.round(seconds * 1000) }, { positionMs: Math.round(seconds * 1000), ageMs: 0 }),
      toggleShuffle: () => command({ type: 'shuffle' }, { shuffle: !state.shuffle }),
      cycleRepeat: () => command({ type: 'repeat' }),
    }
  }

  const store = usePlayerStore.getState()
  return {
    song: localSong,
    isPlaying: localPlaying,
    position: localPosition,
    duration: localDuration,
    shuffle: localShuffle,
    smartShuffle: localSmartShuffle,
    repeat: localRepeat,
    remoteName: null,
    togglePlay: store.togglePlay,
    next: store.next,
    previous: previousOrRestart,
    seek: seekTo,
    toggleShuffle: store.cycleShuffle,
    cycleRepeat: store.cycleRepeat,
  }
}

// Moves playback, with its queue and position, to the chosen device. Choosing this device takes it over from the other.
export function useTransferPlayback() {
  const credentials = useCredentials()
  const send = useSendCommand()
  return (target: RemoteDevice | 'here') => {
    const { devices, deviceId, fetchedAt } = useSessionStore.getState()
    const remote = devices.find((device) => device.active && device.id !== deviceId && device.online && device.state?.song)
    const player = usePlayerStore.getState()

    if (target === 'here') {
      if (!remote?.state?.song) return
      const songs = remote.state.upcoming.length > 0 ? remote.state.upcoming : [remote.state.song]
      setStartPosition(remotePosition(remote, fetchedAt, Date.now()))
      if (player.shuffle) usePlayerStore.setState({ shuffle: false, smartShuffle: false })
      usePlayerStore.getState().playQueue(songs.map((song) => fromRemoteSong(song, credentials)), 0, null)
      void send(remote, { type: 'pause' })
      return
    }

    if (target.id === remote?.id) return
    if (remote?.state?.song) {
      const songs = remote.state.upcoming.length > 0 ? remote.state.upcoming : [remote.state.song]
      void send(target, { type: 'transfer', songs, startIndex: 0, positionMs: Math.round(remotePosition(remote, fetchedAt, Date.now()) * 1000), playing: true })
      return
    }
    const song = player.queue[player.currentIndex]
    if (!song) {
      showToast('Play something first, then move it to another device')
      return
    }
    const songs = player.queue.slice(player.currentIndex, player.currentIndex + 500).map(toRemoteSong)
    void send(target, { type: 'transfer', songs, startIndex: 0, positionMs: Math.round(useProgressStore.getState().position * 1000), playing: true })
    player.setPlaying(false)
  }
}
