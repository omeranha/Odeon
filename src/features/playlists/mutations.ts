import { useQueryClient } from '@tanstack/react-query'
import { showToast } from '../../components/toastStore'
import { createPlaylist, deletePlaylist, replacePlaylistSongs, updatePlaylist, type PlaylistChanges } from '../../lib/subsonic/api'
import type { PlaylistWithSongs, SubsonicPlaylist } from '../../lib/subsonic/types'
import { queryKeys } from '../library/queries'
import { credentialsOf, useCurrentProfile, type Profile } from '../profiles/profileStore'

export function canEditPlaylist(playlist: SubsonicPlaylist, profile: Profile): boolean {
  return !playlist.readonly && (profile.isAdmin || playlist.owner === profile.username)
}

export function nextPlaylistName(playlists: SubsonicPlaylist[], profile: Profile): string {
  const owned = playlists.filter((playlist) => playlist.owner === profile.username).length
  return `My Playlist #${owned + 1}`
}

export function usePlaylistMutations() {
  const profile = useCurrentProfile()
  const queryClient = useQueryClient()
  const credentials = credentialsOf(profile)

  function refresh(playlistId?: string) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
    if (playlistId) void queryClient.invalidateQueries({ queryKey: queryKeys.playlist(playlistId) })
  }

  async function run(action: () => Promise<void>, successMessage?: string): Promise<boolean> {
    try {
      await action()
      if (successMessage) showToast(successMessage)
      return true
    } catch {
      showToast("Couldn't update the playlist. Try again.")
      return false
    }
  }

  return {
    async create(name: string, songIds: string[] = []): Promise<PlaylistWithSongs | undefined> {
      try {
        const playlist = await createPlaylist(credentials, name, songIds)
        refresh()
        return playlist
      } catch {
        showToast("Couldn't create the playlist. Try again.")
        return undefined
      }
    },
    addSongs: (playlist: SubsonicPlaylist, songIds: string[]) => run(() => updatePlaylist(credentials, playlist.id, { songIdsToAdd: songIds }).then(() => refresh(playlist.id)), `Added to ${playlist.name}`),
    removeSong: (playlist: SubsonicPlaylist, index: number) => run(() => updatePlaylist(credentials, playlist.id, { songIndexesToRemove: [index] }).then(() => refresh(playlist.id)), `Removed from ${playlist.name}`),
    reorder: (playlistId: string, songIds: string[]) => run(() => replacePlaylistSongs(credentials, playlistId, songIds).then(() => refresh(playlistId))),
    updateDetails: (playlistId: string, changes: Pick<PlaylistChanges, 'name' | 'comment' | 'public'>) => run(() => updatePlaylist(credentials, playlistId, changes).then(() => refresh(playlistId))),
    remove: (playlist: SubsonicPlaylist) =>
      run(async () => {
        await deletePlaylist(credentials, playlist.id)
        queryClient.removeQueries({ queryKey: queryKeys.playlist(playlist.id) })
        refresh()
      }, 'Removed from Your Library'),
  }
}
