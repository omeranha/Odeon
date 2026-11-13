import clsx from 'clsx'
import { AudioLines, Clock3, Disc3, Pause, Play } from 'lucide-react'
import { Fragment, type CSSProperties, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { DropdownMenu, type MenuEntry } from '../../components/DropdownMenu'
import { ExplicitBadge } from '../../components/ExplicitBadge'
import { QualityBadge } from '../../components/QualityBadge'
import { formatTime } from '../../lib/format'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { SongDownloadIndicator } from '../downloads/SongDownloadIndicator'
import { AddSongButton } from '../getMusic/CatalogResults'
import { usePlayerStore, type PlaySource } from '../player/playerStore'
import { SongCover } from './cards'
import { LikeButton } from './LikeButton'
import { useSongMenuItems } from './songMenu'
import { SongMenuHeader } from './SongMenuHeader'

export interface TrackRowProps {
  song: SubsonicSong
  number: number
  showAlbum?: boolean
  showCover?: boolean
  onPlay: () => void
  extraMenuItems?: MenuEntry[]
  dragHandle?: ReactNode
  rowRef?: Ref<HTMLDivElement>
  rowStyle?: CSSProperties
  dragging?: boolean
}

const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation()

function gridColumns(showAlbum: boolean): string {
  return showAlbum ? 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1.5rem_minmax(0,4fr)_minmax(0,3fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[1.5rem_minmax(0,1fr)_auto]'
}

export function TrackRow({ song, number, showAlbum = false, showCover = false, onPlay, extraMenuItems, dragHandle, rowRef, rowStyle, dragging }: TrackRowProps) {
  const active = usePlayerStore((state) => state.queue[state.currentIndex]?.id === song.id)
  const playing = usePlayerStore((state) => state.isPlaying) && active
  const menuItems = useSongMenuItems(song, extraMenuItems)

  function handleClick() {
    if (window.matchMedia('(pointer: coarse)').matches) onPlay()
  }

  function handleNumberButton(event: { stopPropagation: () => void }) {
    event.stopPropagation()
    if (active) usePlayerStore.getState().togglePlay()
    else onPlay()
  }

  return (
    <div ref={rowRef} style={rowStyle} role="row" onClick={handleClick} onDoubleClick={onPlay} className={clsx('group grid items-center gap-3 rounded-md px-2 py-2 select-none hover:bg-white/10 md:gap-4 md:px-4', gridColumns(showAlbum), dragging && 'bg-highlight shadow-xl')}>
      <div className="hidden w-6 justify-end text-subdued md:flex">
        <span className={clsx('tabular-nums group-hover:hidden', active && 'text-accent')}>{playing ? <AudioLines className="size-4" /> : number}</span>
        <button type="button" aria-label={playing ? 'Pause' : `Play ${song.title}`} onClick={handleNumberButton} onDoubleClick={stopPropagation} className="hidden text-white group-hover:block">
          {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {showCover && <SongCover song={song} size={80} className="size-10 rounded" />}
        <div className="min-w-0">
          <p className={clsx('truncate', active ? 'text-accent' : 'text-white')}>
            {song.title}
            {(song.external?.explicit || song.explicitStatus === 'explicit') && <ExplicitBadge />}
          </p>
          {song.artist && (
            <p className="flex items-center gap-1.5 text-sm text-subdued">
              <SongDownloadIndicator songId={song.id} />
              <span className="truncate">
                {song.artistId ? (
                  <Link to={`/artist/${song.artistId}`} onClick={stopPropagation} className="hover:text-white hover:underline">
                    {song.artist}
                  </Link>
                ) : (
                  song.artist
                )}
              </span>
              <QualityBadge song={song} />
            </p>
          )}
        </div>
      </div>

      {showAlbum && (
        <p className="hidden truncate text-sm text-subdued md:block">
          {song.albumId ? (
            <Link to={`/album/${song.albumId}`} onClick={stopPropagation} className="hover:text-white hover:underline">
              {song.album}
            </Link>
          ) : (
            song.album
          )}
        </p>
      )}

      <div className="flex items-center gap-3 md:gap-4">
        {song.external ? <AddSongButton song={song} /> : <LikeButton kind="song" item={song} size="sm" className="hidden md:block md:opacity-0 md:group-hover:opacity-100 md:data-[starred=true]:opacity-100" />}
        <span className="hidden w-11 text-right text-sm text-subdued tabular-nums md:block">{formatTime(song.duration ?? 0)}</span>
        <DropdownMenu label={`More options for ${song.title}`} items={menuItems} header={<SongMenuHeader song={song} />} className="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100" />
        {dragHandle}
      </div>
    </div>
  )
}

export function TrackListHeader({ showAlbum = false }: { showAlbum?: boolean }) {
  return (
    <div role="row" className={clsx('mb-2 hidden items-center gap-4 border-b border-white/10 px-4 pb-2 text-sm text-subdued md:grid', gridColumns(showAlbum))}>
      <span className="text-right">#</span>
      <span>Title</span>
      {showAlbum && <span>Album</span>}
      <span className="flex justify-end pr-9">
        <Clock3 className="size-4" aria-label="Duration" />
      </span>
    </div>
  )
}

interface TrackListProps {
  songs: SubsonicSong[]
  source: PlaySource
  showAlbum?: boolean
  showCover?: boolean
  showHeader?: boolean
  useTrackNumbers?: boolean
  groupByDisc?: boolean
}

export function TrackList({ songs, source, showAlbum = false, showCover = false, showHeader = true, useTrackNumbers = false, groupByDisc = false }: TrackListProps) {
  const multipleDiscs = groupByDisc && new Set(songs.map((song) => song.discNumber ?? 1)).size > 1
  const play = (index: number) => usePlayerStore.getState().playQueue(songs, index, source)

  return (
    <div role="table" className="px-2 md:px-4">
      {showHeader && <TrackListHeader showAlbum={showAlbum} />}
      {songs.map((song, index) => {
        const discStarts = multipleDiscs && (index === 0 || songs[index - 1].discNumber !== song.discNumber)
        return (
          <Fragment key={`${song.id}-${index}`}>
            {discStarts && (
              <p className="flex items-center gap-3 px-4 pt-6 pb-2 text-sm font-bold text-subdued">
                <Disc3 className="size-4" /> Disc {song.discNumber ?? 1}
              </p>
            )}
            <TrackRow song={song} number={useTrackNumbers ? (song.track ?? index + 1) : index + 1} showAlbum={showAlbum} showCover={showCover} onPlay={() => play(index)} />
          </Fragment>
        )
      })}
    </div>
  )
}
