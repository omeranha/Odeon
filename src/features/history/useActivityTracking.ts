import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { activityApi } from '../../lib/activity'
import { toRemoteSong } from '../../lib/remote'
import { getAudioElement } from '../player/audioEngine'
import { cachePlayedSong } from '../player/playbackCache'
import { usePlayerStore } from '../player/playerStore'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { historyKeys } from './hooks'

// A song counts as played after 30 seconds (or half of it, for short ones), like Spotify.
const PLAYED_AFTER_SECONDS = 30
const REPORT_EVERY_SECONDS = 30
const MAX_REPORT_SECONDS = 600
// currentTime jumps by more than this between updates when the user seeks.
const MAX_STEP_SECONDS = 2

// Follows the audio element's own clock instead of a timer, because browsers throttle timers in background tabs.
export function useActivityTracking() {
  const profile = useCurrentProfile()
  const queryClient = useQueryClient()

  useEffect(() => {
    const credentials = credentialsOf(profile)
    const audio = getAudioElement()
    let lastTime: number | null = null
    let pending = 0
    let songSeconds = 0
    let counted = false
    let trackedPlayback = usePlayerStore.getState().playbackId

    const flush = (keepalive = false) => {
      const seconds = Math.min(Math.floor(pending), MAX_REPORT_SECONDS)
      if (seconds < 1) return
      pending -= seconds
      activityApi.addUsage(credentials, seconds, keepalive).catch(() => {
        pending += seconds
      })
    }

    const handleTimeUpdate = () => {
      const { playbackId, queue, currentIndex } = usePlayerStore.getState()
      if (playbackId !== trackedPlayback) {
        trackedPlayback = playbackId
        songSeconds = 0
        counted = false
      }
      const step = lastTime === null ? 0 : audio.currentTime - lastTime
      lastTime = audio.currentTime
      if (audio.paused || step <= 0 || step > MAX_STEP_SECONDS) return

      pending += step
      songSeconds += step
      const song = queue[currentIndex]
      if (!counted && song && songSeconds >= Math.min(PLAYED_AFTER_SECONDS, (song.duration || Infinity) / 2)) {
        counted = true
        void cachePlayedSong(song, audio.currentSrc)
        activityApi
          .addPlay(credentials, toRemoteSong(song))
          .then(() => queryClient.invalidateQueries({ queryKey: historyKeys.plays }))
          .catch(() => undefined)
      }
      if (pending >= REPORT_EVERY_SECONDS) flush()
    }

    const resetClock = () => {
      lastTime = null
    }
    const handleEnded = () => {
      resetClock()
      songSeconds = 0
      counted = false
    }
    const flushWhenHidden = () => document.visibilityState === 'hidden' && flush(true)
    const flushOnLeave = () => flush(true)

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('pause', resetClock)
    audio.addEventListener('seeking', resetClock)
    audio.addEventListener('emptied', resetClock)
    audio.addEventListener('ended', handleEnded)
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushOnLeave)
    return () => {
      flush(true)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('pause', resetClock)
      audio.removeEventListener('seeking', resetClock)
      audio.removeEventListener('emptied', resetClock)
      audio.removeEventListener('ended', handleEnded)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushOnLeave)
    }
  }, [profile, queryClient])
}
