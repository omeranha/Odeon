import clsx from 'clsx'
import { AudioLines, Check, CircleAlert, CircleArrowDown, ListPlus, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { LoadingState, MessageState } from '../../components/PageState'
import { ExplicitBadge } from '../../components/ExplicitBadge'
import { catalogTrackToSong, type CatalogTrack, type DownloadJob, type ResolvedLink } from '../../lib/downtify'
import { formatTime, pluralize } from '../../lib/format'
import type { SubsonicSong } from '../../lib/subsonic/types'
import { ProgressRing } from '../downloads/DownloadButton'
import { CoverArt } from '../library/cards'
import { useCredentials } from '../library/queries'
import { usePlayerStore } from '../player/playerStore'
import { useCatalogSearch, useJobsById, useRequestDownload } from './hooks'
import { useStartImport } from './imports'

function usePlayCatalog() {
  const credentials = useCredentials()
  return (tracks: CatalogTrack[], index: number, sourceName: string) =>
    usePlayerStore.getState().playQueue(
      tracks.map((track) => catalogTrackToSong(credentials, track)),
      index,
      { type: 'search', name: sourceName },
    )
}

export function CatalogResults({ query }: { query: string }) {
  const result = useCatalogSearch(query)
  const jobs = useJobsById()

  if (!result.link && query.trim().length < 2) return <MessageState title="Keep typing" message="Type at least 2 characters, or paste a Spotify or YouTube Music link." />
  if (result.isPending) return <LoadingState />
  if (result.isError) return <MessageState title={result.link ? "Couldn't open that link" : 'Search failed'} message={result.error instanceof Error ? result.error.message : 'Try again in a moment.'} />

  return (
    <div className="px-2 md:px-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-2">
        <p className="text-sm text-subdued">{result.link ? 'From the link you pasted' : 'From YouTube Music. Double-click to play, or add songs to your library.'}</p>
        <Link to="/get-music" className="shrink-0 text-sm font-bold text-subdued hover:text-white hover:underline">
          View downloads
        </Link>
      </div>
      {result.link ? <LinkResult link={result.data} url={query.trim()} jobs={jobs} /> : <TrackRows tracks={result.data} jobs={jobs} sourceName="YouTube Music" />}
    </div>
  )
}

export function AddSongButton({ song }: { song: SubsonicSong }) {
  const catalogId = song.external?.catalogId ?? ''
  const job = useJobsById().get(catalogId)
  const request = useRequestDownload()
  const [requesting, setRequesting] = useState(false)
  if (!song.external) return null

  async function handleRequest() {
    setRequesting(true)
    await request([{ id: catalogId, title: song.title, artists: song.artist ? [song.artist] : [], explicit: Boolean(song.external?.explicit) }])
    setRequesting(false)
  }

  return <JobButton job={job} busy={requesting} title={song.title} iconClassName="size-5" onRequest={() => void handleRequest()} />
}

function LinkResult({ link, url, jobs }: { link: ResolvedLink; url: string; jobs: Map<string, DownloadJob> }) {
  const request = useRequestDownload()
  const startImport = useStartImport()
  const [requesting, setRequesting] = useState(false)
  const canImport = link.kind === 'playlist' || link.kind === 'album'

  async function importAsPlaylist() {
    setRequesting(true)
    await startImport(url)
    setRequesting(false)
  }
  const pending = link.tracks.filter((track) => !jobs.has(track.id))

  async function requestAll() {
    setRequesting(true)
    await request(pending)
    setRequesting(false)
  }

  if (link.tracks.length === 0) return <MessageState title="Nothing to download" message="This link has no songs Downtify can get. Artist links aren't supported yet; open one of their albums instead." />

  return (
    <>
      <div className="mb-4 flex items-center gap-4 rounded-lg bg-white/5 p-4">
        <CoverArt src={link.coverUrl} size={300} className="size-20 rounded md:size-24" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-wide text-subdued uppercase">{link.kind}</p>
          <p className="truncate text-xl font-bold md:text-2xl">{link.name}</p>
          <p className="truncate text-sm text-subdued">{[link.subtitle, link.year, pluralize(link.tracks.length, 'song')].filter(Boolean).join(' • ')}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {canImport && (
            <button type="button" disabled={requesting} onClick={() => void importAsPlaylist()} title="Create a playlist in your library and add every song, downloading the ones you don't have" className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black transition hover:scale-105 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
              <ListPlus className="size-4" />
              <span className="hidden sm:inline">Import as playlist</span>
            </button>
          )}
          <button type="button" disabled={requesting || pending.length === 0} onClick={() => void requestAll()} className="flex items-center gap-2 rounded-full border border-white/50 px-4 py-2 text-sm font-bold transition hover:scale-105 hover:border-white disabled:pointer-events-none disabled:opacity-50">
            <CircleArrowDown className="size-4" />
            <span className="hidden sm:inline">{pending.length === 0 ? 'Requested' : 'Get all'}</span>
          </button>
        </div>
      </div>
      <TrackRows tracks={link.tracks} jobs={jobs} sourceName={link.name} numbered />
    </>
  )
}

function TrackRows({ tracks, jobs, sourceName, numbered = false }: { tracks: CatalogTrack[]; jobs: Map<string, DownloadJob>; sourceName: string; numbered?: boolean }) {
  const play = usePlayCatalog()
  if (tracks.length === 0) return <MessageState title="No results" message="Try the artist and song name, or paste a link." />
  return (
    <ul>
      {tracks.map((track, index) => (
        <TrackRow key={`${track.id}-${index}`} track={track} job={jobs.get(track.id)} number={numbered ? (track.trackNumber ?? index + 1) : undefined} onPlay={() => play(tracks, index, sourceName)} />
      ))}
    </ul>
  )
}

function TrackRow({ track, job, number, onPlay }: { track: CatalogTrack; job?: DownloadJob; number?: number; onPlay: () => void }) {
  const request = useRequestDownload()
  const [requesting, setRequesting] = useState(false)
  const active = usePlayerStore((state) => state.queue[state.currentIndex]?.external?.catalogId === track.id)
  const playing = usePlayerStore((state) => state.isPlaying) && active

  async function handleRequest() {
    setRequesting(true)
    await request([track])
    setRequesting(false)
  }

  function handleClick() {
    if (window.matchMedia('(pointer: coarse)').matches) onPlay()
  }

  function handlePlayButton(event: { stopPropagation: () => void }) {
    event.stopPropagation()
    if (active) usePlayerStore.getState().togglePlay()
    else onPlay()
  }

  const playIcon = playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />

  return (
    <li onClick={handleClick} onDoubleClick={onPlay} className="group flex cursor-default items-center gap-3 rounded-md px-2 py-2 select-none hover:bg-white/10">
      {number !== undefined ? (
        <span className="hidden w-6 justify-end text-sm text-subdued tabular-nums md:flex">
          <span className={clsx('group-hover:hidden', active && 'text-accent')}>{playing ? <AudioLines className="size-4" /> : number}</span>
          <button type="button" aria-label={playing ? 'Pause' : `Play ${track.title}`} onClick={handlePlayButton} className="hidden text-white group-hover:block">
            {playIcon}
          </button>
        </span>
      ) : (
        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-highlight text-subdued">
          <CoverArt src={track.coverUrl} size={80} className="size-full" />
          <button type="button" aria-label={playing ? 'Pause' : `Play ${track.title}`} onClick={handlePlayButton} className={clsx('absolute inset-0 hidden place-items-center bg-black/50 text-white md:grid', !playing && 'md:opacity-0 md:group-hover:opacity-100')}>
            {playIcon}
          </button>
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate', active && 'text-accent')}>
          {track.title}
          {track.explicit && <ExplicitBadge />}
        </p>
        <p className="truncate text-sm text-subdued">{[track.artists.join(', '), track.album].filter(Boolean).join(' • ')}</p>
      </div>
      {track.duration ? <span className="hidden text-sm text-subdued tabular-nums md:block">{formatTime(track.duration)}</span> : null}
      <JobButton job={job} busy={requesting} title={track.title} onRequest={() => void handleRequest()} />
    </li>
  )
}

function JobButton({ job, busy, title, iconClassName = 'size-6', onRequest }: { job?: DownloadJob; busy: boolean; title: string; iconClassName?: string; onRequest: () => void }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  if (job?.status === 'done') return <Check className={clsx(iconClassName, 'shrink-0 text-accent')} aria-label="In your library" />
  if (job?.status === 'queued' || job?.status === 'downloading') return <ProgressRing progress={job.progress / 100} className={clsx(iconClassName, 'shrink-0 text-accent')} />
  return (
    <button
      type="button"
      aria-label={job?.status === 'error' ? `Retry adding ${title}` : `Add ${title} to your library`}
      title={job?.status === 'error' ? 'Retry' : 'Add to your library'}
      disabled={busy}
      onClick={(event) => {
        stop(event)
        onRequest()
      }}
      onDoubleClick={stop}
      className={clsx('shrink-0 transition hover:scale-105 disabled:opacity-50', job?.status === 'error' ? 'text-danger' : 'text-subdued hover:text-white')}
    >
      {job?.status === 'error' ? <CircleAlert className={iconClassName} /> : <CircleArrowDown className={iconClassName} />}
    </button>
  )
}
