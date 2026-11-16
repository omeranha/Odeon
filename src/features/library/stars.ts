import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { showToast } from '../../components/toastStore'
import { likedSongsApi } from '../../lib/activity'
import { toRemoteSong } from '../../lib/remote'
import { setStarred, type StarKind } from '../../lib/subsonic/api'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { queryKeys, useExternalLikes } from './queries'

interface StarOverrideState {
  overrides: Record<string, boolean>
  set: (id: string, starred: boolean) => void
  markStarred: (ids: string[]) => void
  reset: () => void
}

// Cached album/playlist responses keep their old `starred` field, so local overrides make a toggle show up everywhere at once.
export const useStarStore = create<StarOverrideState>()((set) => ({
  overrides: {},
  set: (id, starred) => set((state) => ({ overrides: { ...state.overrides, [id]: starred } })),
  markStarred: (ids) => set((state) => ({ overrides: { ...state.overrides, ...Object.fromEntries(ids.map((id) => [id, true])) } })),
  reset: () => set({ overrides: {} }),
}))

const messages: Record<StarKind, { added: string; removed: string }> = {
  song: { added: 'Added to Liked Songs', removed: 'Removed from Liked Songs' },
  album: { added: 'Saved to Your Library', removed: 'Removed from Your Library' },
  artist: { added: 'Following', removed: 'Unfollowed' },
}

export function useIsStarred(item: { id: string; starred?: string }): boolean {
  const override = useStarStore((state) => state.overrides[item.id])
  return override ?? Boolean(item.starred)
}

// Songs from YouTube Music have no `starred` field; the ones this user liked are marked from the server's list.
export function useSyncExternalLikes() {
  const { data } = useExternalLikes()
  useEffect(() => {
    if (data) useStarStore.getState().markStarred(data.map((entry) => entry.song.id))
  }, [data])
}

export function useToggleStar() {
  const profile = useCurrentProfile()
  const queryClient = useQueryClient()

  return useCallback(
    async (kind: StarKind, id: string, starred: boolean) => {
      const { set } = useStarStore.getState()
      set(id, starred)
      try {
        await setStarred(credentialsOf(profile), kind, id, starred)
        showToast(starred ? messages[kind].added : messages[kind].removed)
        void queryClient.invalidateQueries({ queryKey: queryKeys.starred })
      } catch {
        set(id, !starred)
        showToast("Couldn't update your library. Try again.")
      }
    },
    [profile, queryClient],
  )
}

// A song from the library is starred in Navidrome. One from YouTube Music isn't there, so the server keeps the like.
export function useToggleSongLike() {
  const profile = useCurrentProfile()
  const queryClient = useQueryClient()
  const toggleStar = useToggleStar()

  return useCallback(
    async (song: SubsonicSong, liked: boolean) => {
      if (!song.external) return toggleStar('song', song.id, liked)
      const { set } = useStarStore.getState()
      const credentials = credentialsOf(profile)
      set(song.id, liked)
      try {
        await (liked ? likedSongsApi.add(credentials, toRemoteSong(song)) : likedSongsApi.remove(credentials, song.id))
        showToast(liked ? messages.song.added : messages.song.removed)
        void queryClient.invalidateQueries({ queryKey: queryKeys.likedSongs })
      } catch {
        set(song.id, !liked)
        showToast("Couldn't update your liked songs. Try again.")
      }
    },
    [profile, queryClient, toggleStar],
  )
}
