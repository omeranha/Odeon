import { useMemo } from 'react'
import { fromRemoteSong } from '../../lib/remote'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'
import { useExternalLikes, useStarred } from './queries'

const NO_SONGS: SubsonicSong[] = []

function likedAt(song: SubsonicSong): number {
  const time = song.starred ? Date.parse(song.starred) : NaN
  return Number.isNaN(time) ? 0 : time
}

export function useLikedSongs() {
  const profile = useCurrentProfile()
  const starred = useStarred()
  const external = useExternalLikes()
  const librarySongs = starred.data?.song ?? NO_SONGS
  const externalLikes = external.data

  const songs = useMemo(() => {
    if (!externalLikes?.length) return librarySongs
    const streamed = externalLikes.map((entry): SubsonicSong => ({ ...fromRemoteSong(entry.song, credentialsOf(profile)), starred: new Date(entry.at).toISOString() }))
    return [...librarySongs, ...streamed].sort((a, b) => likedAt(b) - likedAt(a))
  }, [librarySongs, externalLikes, profile])

  return { songs, librarySongs, isPending: starred.isPending }
}
