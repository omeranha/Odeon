import { CircleArrowDown, CircleX, Disc3, Heart, LibraryBig, ListEnd, ListPlus, User } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { MenuEntry } from '../../components/DropdownMenu'
import { showToast } from '../../components/toastStore'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { downloadSongs, removeSongDownload } from '../downloads/downloadManager'
import { useDownloadContext, useSongDownload } from '../downloads/hooks'
import { useRequestDownload } from '../getMusic/hooks'
import { usePlayerStore } from '../player/playerStore'
import { useAddToPlaylistStore } from '../playlists/addToPlaylistStore'
import { useIsStarred, useToggleSongLike } from './stars'

export function useSongMenuItems(song: SubsonicSong, extraItems: MenuEntry[] = []): MenuEntry[] {
  const navigate = useNavigate()
  const starred = useIsStarred(song)
  const toggleSongLike = useToggleSongLike()
  const openAddToPlaylist = useAddToPlaylistStore((state) => state.open)
  const download = useSongDownload(song.id)
  const downloadContext = useDownloadContext()
  const downloaded = download !== undefined && download.state !== 'error'
  const requestDownload = useRequestDownload()

  async function handleRemoveDownload() {
    const removed = await removeSongDownload(song.id)
    showToast(removed ? 'Removed from your downloads' : 'This song is still part of a downloaded album or playlist')
  }

  const addToQueue: MenuEntry = {
    label: 'Add to queue',
    icon: ListEnd,
    onSelect: () => {
      usePlayerStore.getState().addToQueue([song])
      showToast('Added to queue')
    },
  }

  const likeEntry: MenuEntry = { label: starred ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: Heart, onSelect: () => void toggleSongLike(song, !starred) }

  // Streamed songs aren't in Navidrome yet, so playlists and offline downloads only work after they're added.
  const external = song.external
  if (external) {
    return [
      likeEntry,
      { label: 'Add to your library', icon: LibraryBig, onSelect: () => void requestDownload([{ id: external.catalogId, title: song.title, artists: song.artist ? [song.artist] : [], explicit: false }]) },
      addToQueue,
    ]
  }

  return [
    { label: 'Add to playlist', icon: ListPlus, onSelect: () => openAddToPlaylist([song]) },
    ...extraItems,
    likeEntry,
    addToQueue,
    downloaded
      ? { label: 'Remove download', icon: CircleX, onSelect: () => void handleRemoveDownload() }
      : {
          label: 'Download',
          icon: CircleArrowDown,
          onSelect: () => {
            downloadSongs([song], downloadContext)
            showToast('Downloading')
          },
        },
    song.artistId ? { label: 'Go to artist', icon: User, onSelect: () => navigate(`/artist/${song.artistId}`) } : null,
    song.albumId ? { label: 'Go to album', icon: Disc3, onSelect: () => navigate(`/album/${song.albumId}`) } : null,
  ]
}
