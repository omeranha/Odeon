import { Heart } from 'lucide-react'
import { LoadingState, MessageState } from '../components/PageState'
import { PlayButton } from '../components/PlayButton'
import { pluralize } from '../lib/format'
import { DownloadButton } from '../features/downloads/DownloadButton'
import { useKeepDownloadInSync } from '../features/downloads/hooks'
import { LikedSongsArtwork } from '../features/library/cards'
import { CollectionPage, MetaSeparator, ShuffleToggle } from '../features/library/CollectionPage'
import { useStarred } from '../features/library/queries'
import { TrackList } from '../features/library/TrackList'
import { useCollectionPlayback } from '../features/player/playback'
import { useCurrentProfile } from '../features/profiles/profileStore'

const source = { type: 'liked' as const, name: 'Liked Songs' }
const NO_SONGS: never[] = []

export function LikedSongsPage() {
  const profile = useCurrentProfile()
  const { data, isPending } = useStarred()
  const songs = data?.song ?? NO_SONGS
  const playback = useCollectionPlayback(source, songs)
  const downloadInput = { type: 'liked' as const, id: 'songs', name: 'Liked Songs', songs, snapshot: { song: songs } }
  useKeepDownloadInSync(downloadInput)

  return (
    <CollectionPage
      color="80 56 160"
      artwork={<LikedSongsArtwork className="size-full" />}
      label="Playlist"
      title="Liked Songs"
      meta={
        <>
          <span className="font-bold text-white">{profile.displayName}</span>
          <MetaSeparator />
          <span>{pluralize(songs.length, 'song')}</span>
        </>
      }
      actions={
        songs.length > 0 && (
          <>
            <PlayButton playing={playback.playing} label="Liked Songs" size="lg" onClick={playback.toggle} />
            <ShuffleToggle />
            <DownloadButton {...downloadInput} />
          </>
        )
      }
    >
      {isPending ? (
        <LoadingState />
      ) : songs.length > 0 ? (
        <TrackList songs={songs} source={source} showAlbum showCover />
      ) : (
        <MessageState icon={<Heart className="size-12 text-subdued" />} title="Songs you like will appear here" message="Save songs by tapping the heart icon." />
      )}
    </CollectionPage>
  )
}
