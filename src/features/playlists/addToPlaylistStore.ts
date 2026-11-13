import { create } from 'zustand'
import type { SubsonicSong } from '../../lib/subsonic/types'

interface AddToPlaylistState {
  songs: SubsonicSong[] | null
  open: (songs: SubsonicSong[]) => void
  close: () => void
}

export const useAddToPlaylistStore = create<AddToPlaylistState>()((set) => ({
  songs: null,
  open: (songs) => set({ songs }),
  close: () => set({ songs: null }),
}))
