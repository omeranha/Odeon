import { ListEnd, ListMusic, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ConfirmDialog } from '../components/Dialog'
import { DropdownMenu } from '../components/DropdownMenu'
import { LoadingState, MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import { showToast } from '../components/toastStore'
import { formatTotalDuration, pluralize } from '../lib/format'
import { useDominantColor } from '../lib/hooks'
import type { PlaylistWithSongs } from '../lib/subsonic/types'
import { CoverArt } from '../features/library/cards'
import { CollectionPage, MetaSeparator, ShuffleToggle } from '../features/library/CollectionPage'
import { DownloadButton } from '../features/downloads/DownloadButton'
import { useKeepDownloadInSync } from '../features/downloads/hooks'
import { useCoverArtUrl, usePlaylist } from '../features/library/queries'
import { useCollectionPlayback } from '../features/player/playback'
import { usePlayerStore } from '../features/player/playerStore'
import { EditPlaylistDialog } from '../features/playlists/EditPlaylistDialog'
import { canEditPlaylist, usePlaylistMutations } from '../features/playlists/mutations'
import { PlaylistSongFinder } from '../features/playlists/PlaylistSongFinder'
import { PlaylistTrackList } from '../features/playlists/PlaylistTrackList'
import { useCurrentProfile } from '../features/profiles/profileStore'
import { useImportForPlaylist } from '../features/getMusic/imports'
import { ImportStatus } from '../features/getMusic/ImportStatus'

const COVER_SIZE = 600

export function PlaylistPage() {
  const { id = '' } = useParams()
  const { data: playlist, isPending, isError } = usePlaylist(id)
  if (isPending) return <LoadingState />
  if (isError) return <MessageState icon={<ListMusic className="size-12 text-subdued" />} title="Couldn't load this playlist" message="It may have been deleted, or the server is unreachable." />
  return <PlaylistView key={playlist.id} playlist={playlist} />
}

function PlaylistView({ playlist }: { playlist: PlaylistWithSongs }) {
  const profile = useCurrentProfile()
  const navigate = useNavigate()
  const editable = canEditPlaylist(playlist, profile)
  const songs = playlist.entry ?? []
  const color = useDominantColor(useCoverArtUrl(songs.length > 0 ? playlist.coverArt : undefined, COVER_SIZE))
  const source = { type: 'playlist' as const, id: playlist.id, name: playlist.name }
  const playback = useCollectionPlayback(source, songs)
  const { remove } = usePlaylistMutations()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [finderOpen, setFinderOpen] = useState(songs.length === 0)
  const playlistImport = useImportForPlaylist(playlist.id)
  const runningImport = playlistImport?.running ? playlistImport : undefined
  const downloadInput = { type: 'playlist' as const, id: playlist.id, name: playlist.name, coverArt: playlist.coverArt, songs, snapshot: playlist }
  useKeepDownloadInSync(downloadInput)

  async function handleDelete() {
    setConfirmingDelete(false)
    if (await remove(playlist)) navigate('/', { replace: true })
  }

  return (
    <>
      <CollectionPage
        color={color}
        artwork={songs.length > 0 ? <CoverArt coverArtId={playlist.coverArt} size={COVER_SIZE} kind="playlist" className="size-full" /> : <CoverArt size={COVER_SIZE} kind="playlist" className="size-full" />}
        label={playlist.public ? 'Public Playlist' : 'Playlist'}
        title={playlist.name}
        onTitleClick={editable ? () => setEditing(true) : undefined}
        description={playlist.comment}
        meta={
          <>
            <span className="font-bold text-white">{playlist.owner}</span>
            <MetaSeparator />
            <span>
              {pluralize(songs.length, 'song')}
              {songs.length > 0 && `, ${formatTotalDuration(playlist.duration)}`}
            </span>
          </>
        }
        actions={
          <>
            {songs.length > 0 && <PlayButton playing={playback.playing} label={playlist.name} size="lg" onClick={playback.toggle} />}
            {songs.length > 0 && <ShuffleToggle />}
            {songs.length > 0 && <DownloadButton {...downloadInput} />}
            <DropdownMenu
              label={`More options for ${playlist.name}`}
              className="[&_svg]:size-7"
              items={[
                editable && { label: 'Edit details', icon: Pencil, onSelect: () => setEditing(true) },
                editable && songs.length > 0 && { label: 'Find songs to add', icon: Search, onSelect: () => setFinderOpen(true) },
                songs.length > 0 && {
                  label: 'Add to queue',
                  icon: ListEnd,
                  onSelect: () => {
                    usePlayerStore.getState().addToQueue(songs)
                    showToast('Added to queue')
                  },
                },
                editable && { label: 'Delete', icon: Trash2, onSelect: () => setConfirmingDelete(true) },
              ]}
            />
          </>
        }
      >
        {playlistImport && <ImportStatus entry={playlistImport} />}
        {songs.length > 0 && <PlaylistTrackList playlist={playlist} editable={editable} />}
        {editable && !runningImport && (songs.length === 0 || finderOpen) && <PlaylistSongFinder playlist={playlist} onClose={songs.length > 0 ? () => setFinderOpen(false) : undefined} />}
        {!editable && songs.length === 0 && <MessageState title="This playlist is empty" />}
      </CollectionPage>

      {editing && <EditPlaylistDialog playlist={playlist} onClose={() => setEditing(false)} />}
      {confirmingDelete && <ConfirmDialog title="Delete from Your Library?" message={`This will delete ${playlist.name} for everyone.`} confirmLabel="Delete" onConfirm={() => void handleDelete()} onClose={() => setConfirmingDelete(false)} />}
    </>
  )
}
