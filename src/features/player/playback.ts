import { useCallback } from 'react'
import { showToast } from '../../components/toastStore'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { useLibraryFetchers } from '../library/queries'
import { primeAudio } from './audioEngine'
import { isSameSource, usePlayerStore, type PlaySource } from './playerStore'

export function useIsSourcePlaying(source: Pick<PlaySource, 'type' | 'id'>): boolean {
  return usePlayerStore((state) => state.isPlaying && isSameSource(state.source, source))
}

export function useCollectionPlayback(source: PlaySource, songs: SubsonicSong[] | undefined) {
  const playing = useIsSourcePlaying(source)
  const toggle = () => {
    const store = usePlayerStore.getState()
    if (isSameSource(store.source, source)) store.togglePlay()
    else if (songs?.length) store.playQueue(songs, null, source)
  }
  return { playing, toggle }
}

export function usePlayRemoteCollection() {
  const fetchers = useLibraryFetchers()

  return useCallback(
    async (source: PlaySource & { type: 'album' | 'playlist'; id: string }) => {
      const store = usePlayerStore.getState()
      if (isSameSource(store.source, source)) {
        store.togglePlay()
        return
      }
      primeAudio()
      try {
        const songs = source.type === 'album' ? (await fetchers.album(source.id)).song : (await fetchers.playlist(source.id)).entry
        if (songs?.length) usePlayerStore.getState().playQueue(songs, null, source)
      } catch {
        showToast("Couldn't start playback. Try again.")
      }
    },
    [fetchers],
  )
}
