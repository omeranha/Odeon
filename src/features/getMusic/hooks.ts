import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, downtifyApi, getDowntifyStatus, isMusicLink, type CatalogTrack, type DownloadJob } from '../../lib/downtify'
import { useCredentials } from '../library/queries'

const LIBRARY_REFRESH_DELAY_MS = 5000

export const getMusicKeys = {
  status: ['getMusic', 'status'] as const,
  search: (query: string) => ['getMusic', 'search', query] as const,
  resolve: (url: string) => ['getMusic', 'resolve', url] as const,
  queue: ['getMusic', 'queue'] as const,
}

export function useGetMusicEnabled(): boolean {
  const { data } = useQuery({ queryKey: getMusicKeys.status, queryFn: getDowntifyStatus, staleTime: 10 * 60 * 1000 })
  return data === true
}

export function useCatalogSearch(query: string, enabled = true) {
  const credentials = useCredentials()
  const trimmed = query.trim()
  const link = isMusicLink(trimmed)
  const search = useQuery({ queryKey: getMusicKeys.search(trimmed), queryFn: ({ signal }) => downtifyApi.search(credentials, trimmed, signal), enabled: enabled && !link && trimmed.length >= 2, staleTime: 10 * 60 * 1000, retry: false })
  const resolve = useQuery({ queryKey: getMusicKeys.resolve(trimmed), queryFn: ({ signal }) => downtifyApi.resolve(credentials, trimmed, signal), enabled: enabled && link, staleTime: 10 * 60 * 1000, retry: false })
  return link ? { link: true as const, ...resolve } : { link: false as const, ...search }
}

export function useRequestDownload() {
  const credentials = useCredentials()
  const queryClient = useQueryClient()
  return async (tracks: CatalogTrack[]) => {
    try {
      const result = await downtifyApi.download(credentials, tracks.map((track) => track.id))
      showToast(result.queued === 1 ? `Getting ${tracks[0].title}` : `Getting ${result.queued} songs`)
      if (result.unverified) showToast(`${result.unverified === 1 ? "1 song couldn't" : `${result.unverified} songs couldn't`} be matched exactly on YouTube Music, so Downtify picked the closest one.`)
      void queryClient.invalidateQueries({ queryKey: getMusicKeys.queue })
      return true
    } catch (error) {
      showToast(error instanceof DowntifyApiError ? error.message : "Couldn't start the download. Try again.")
      return false
    }
  }
}

function hasActiveJobs(jobs: DownloadJob[] | undefined): boolean {
  return Boolean(jobs?.some((job) => job.status === 'queued' || job.status === 'downloading'))
}

export function useDownloadJobs(enabled: boolean) {
  const credentials = useCredentials()
  return useQuery({
    queryKey: getMusicKeys.queue,
    queryFn: () => downtifyApi.queue(credentials),
    enabled,
    refetchInterval: (current) => (hasActiveJobs(current.state.data) ? 2000 : 20000),
  })
}

// Navidrome's file watcher imports finished files on its own; the app only needs to refetch library data afterwards.
export function useLibraryRefreshOnDownloads(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data } = useDownloadJobs(enabled)
  const doneIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!data) return
    const done = new Set(data.filter((job) => job.status === 'done').map((job) => job.id))
    const previous = doneIds.current
    doneIds.current = done
    if (!previous || ![...done].some((id) => !previous.has(id))) return
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey[0] !== 'getMusic' && entry.queryKey[0] !== 'session' })
    }, LIBRARY_REFRESH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [data, queryClient])
}

export function useJobsById(): Map<string, DownloadJob> {
  const { data } = useDownloadJobs(useGetMusicEnabled())
  return new Map((data ?? []).map((job) => [job.id, job]))
}
