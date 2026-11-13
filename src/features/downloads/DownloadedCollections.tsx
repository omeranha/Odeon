import { Link } from 'react-router'
import { CardGrid, CoverArt, LikedSongsArtwork } from '../library/cards'
import { collectionPath, useDownloadedCollections } from './hooks'

export function DownloadedCollections() {
  const collections = useDownloadedCollections()
  if (collections.length === 0) return <p className="px-4 text-sm text-subdued md:px-6">Nothing downloaded yet. Download albums and playlists to listen without a connection.</p>

  return (
    <CardGrid>
      {collections.map((collection) => (
        <Link key={collection.key} to={collectionPath(collection)} className="block rounded-md p-2 transition-colors hover:bg-highlight md:p-3">
          {collection.type === 'liked' ? <LikedSongsArtwork className="mb-2 aspect-square w-full rounded-md" /> : <CoverArt coverArtId={collection.coverArt} size={300} kind={collection.type === 'playlist' ? 'playlist' : 'album'} className="mb-2 aspect-square w-full rounded-md shadow-lg shadow-black/50" />}
          <p className="truncate font-semibold">{collection.name}</p>
          <p className="text-sm text-subdued capitalize">{collection.type === 'liked' ? 'Playlist' : collection.type}</p>
        </Link>
      ))}
    </CardGrid>
  )
}
