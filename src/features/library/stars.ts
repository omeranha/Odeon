import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { create } from 'zustand'
import { showToast } from '../../components/toastStore'
import { setStarred, type StarKind } from '../../lib/subsonic/api'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { queryKeys } from './queries'

interface StarOverrideState {
  overrides: Record<string, boolean>
  set: (id: string, starred: boolean) => void
  reset: () => void
}

// Cached album/playlist responses keep their old `starred` field, so local overrides make a toggle show up everywhere at once.
export const useStarStore = create<StarOverrideState>()((set) => ({
  overrides: {},
  set: (id, starred) => set((state) => ({ overrides: { ...state.overrides, [id]: starred } })),
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
