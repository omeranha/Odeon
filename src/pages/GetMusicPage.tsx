import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CircleArrowDown, Link2, ListMusic } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { LoadingState, MessageState } from '../components/PageState'
import { showToast } from '../components/toastStore'
import { downtifyApi, isMusicLink, type DownloadJob } from '../lib/downtify'
import { getMusicKeys, useDownloadJobs, useGetMusicEnabled } from '../features/getMusic/hooks'
import { useImports } from '../features/getMusic/imports'
import { CoverArt } from '../features/library/cards'
import { useCredentials } from '../features/library/queries'

const statusLabels: Record<DownloadJob['status'], string> = {
  queued: 'Waiting',
  downloading: 'Downloading',
  done: 'In your library',
  error: 'Failed',
}

export function GetMusicPage() {
  const enabled = useGetMusicEnabled()
  const { data: jobs, isPending, isError } = useDownloadJobs(enabled)
  const credentials = useCredentials()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [link, setLink] = useState('')
  const hasFinished = jobs?.some((job) => job.status === 'done')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = link.trim()
    if (!isMusicLink(value)) {
      showToast('Paste a Spotify, YouTube Music, Deezer or SoundCloud link')
      return
    }
    navigate(`/search?q=${encodeURIComponent(value)}`)
  }

  async function clearFinished() {
    await downtifyApi.clearCompleted(credentials).catch(() => showToast("Couldn't clear finished downloads."))
    void queryClient.invalidateQueries({ queryKey: getMusicKeys.queue })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-2 text-3xl font-bold">Get music</h1>
      <p className="mb-6 text-sm text-subdued">Add songs that aren't in your library yet. Search for them from the Search page, or paste a Spotify or YouTube Music link for a song, album or playlist.</p>

      {!enabled ? (
        <MessageState title="Getting music isn't set up" message="Ask your server administrator to connect Downtify to Odeon." />
      ) : (
        <>
          <form onSubmit={handleSubmit} className="mb-10 flex gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-full bg-elevated px-4 py-2.5 focus-within:ring-2 focus-within:ring-white">
              <Link2 className="size-5 shrink-0 text-subdued" />
              <input value={link} onChange={(event) => setLink(event.target.value)} inputMode="url" placeholder="https://open.spotify.com/album/…" className="w-full bg-transparent text-base outline-none placeholder:text-subdued md:text-sm" />
            </label>
            <button type="submit" className="rounded-full bg-white px-5 text-sm font-bold text-black transition hover:scale-105">
              Open
            </button>
          </form>

          <ImportList />

          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Downloads</h2>
            {hasFinished && (
              <button type="button" onClick={() => void clearFinished()} className="rounded-full border border-white/50 px-4 py-1.5 text-sm font-bold transition hover:scale-105 hover:border-white">
                Clear finished
              </button>
            )}
          </div>

          {isPending ? (
            <LoadingState />
          ) : isError ? (
            <MessageState title="Couldn't load downloads" message="Check that Downtify is running and try again." />
          ) : jobs.length === 0 ? (
            <MessageState icon={<CircleArrowDown className="size-12 text-subdued" />} title="Nothing downloading" message="Songs you ask for show up here while they download." />
          ) : (
            <ul className="flex flex-col gap-1">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function JobRow({ job }: { job: DownloadJob }) {
  const active = job.status === 'queued' || job.status === 'downloading'
  return (
    <li className="flex items-center gap-3 rounded-md bg-white/5 p-2.5">
      <CoverArt src={job.coverUrl} size={80} className="size-11 rounded" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">{job.title}</p>
          <span className={clsx('shrink-0 text-xs font-bold', job.status === 'done' && 'text-accent', job.status === 'error' && 'text-danger', active && 'text-subdued')}>{job.status === 'downloading' && job.progress > 0 ? `${Math.round(job.progress)}%` : job.status === 'queued' && job.position ? `#${job.position} in line` : statusLabels[job.status]}</span>
        </div>
        <p className="truncate text-xs text-subdued">{job.status === 'error' && job.message ? job.message : job.artists.join(', ')}</p>
        {active && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${job.progress}%` }} />
          </div>
        )}
      </div>
    </li>
  )
}

function ImportList() {
  const { data: imports } = useImports()
  if (!imports?.length) return null

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-bold">Playlist imports</h2>
      <ul className="flex flex-col gap-1">
        {imports.map((entry) => {
          const percent = entry.total > 0 ? Math.round(((entry.added + entry.failed) / entry.total) * 100) : 100
          return (
            <li key={entry.id}>
              <Link to={`/playlist/${entry.playlistId}`} className="block rounded-md bg-white/5 p-3 transition-colors hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <ListMusic className="size-5 shrink-0 text-subdued" />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.name}</p>
                  <span className={clsx('shrink-0 text-xs font-bold', entry.running ? 'text-subdued' : entry.error || entry.failed > 0 ? 'text-danger' : 'text-accent')}>{entry.running ? `${percent}%` : entry.error ? 'Stopped' : entry.failed > 0 ? 'Incomplete' : 'Done'}</span>
                </div>
                <p className="mt-1 pl-8 text-xs text-subdued">
                  {entry.added} of {entry.total} songs added
                  {entry.failed > 0 && ` • ${entry.failed} couldn't be found`}
                  {entry.error && ` • ${entry.error}`}
                </p>
                {!entry.running && entry.failed > 0 && <span className="mt-1 block pl-8 text-xs font-bold text-white underline">Open the playlist to retry</span>}
                {entry.running && (
                  <div className="mt-2 ml-8 h-1 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
