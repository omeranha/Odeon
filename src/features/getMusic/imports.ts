import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { showToast } from '../../components/toastStore'
import { DowntifyApiError, importApi, type PlaylistImport } from '../../lib/downtify'
import { queryKeys, useCredentials } from '../library/queries'
import { useGetMusicEnabled } from './hooks'

export const importsKey = ['getMusic', 'imports'] as const

export function useImports() {
  const credentials = useCredentials()
  const enabled = useGetMusicEnabled()
  return useQuery({
    queryKey: importsKey,
    queryFn: () => importApi.list(credentials),
    enabled,
    refetchInterval: (current) => (current.state.data?.some((entry) => entry.running) ? 3000 : 30000),
  })
}

// The most recent import that created this playlist, whether it's still running or finished with missing songs.
export function useImportForPlaylist(playlistId: string): PlaylistImport | undefined {
  const { data } = useImports()
  return data?.find((entry) => entry.playlistId === playlistId)
}

export function useImportFailures(importId: string, enabled: boolean, revision: number) {
  const credentials = useCredentials()
  return useQuery({ queryKey: ['getMusic', 'imports', importId, 'failures', revision], queryFn: () => importApi.failures(credentials, importId), enabled })
}

export function useStartImport() {
  const credentials = useCredentials()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async (url: string) => {
    try {
      const started = await importApi.start(credentials, url)
      showToast(`Importing ${started.name}`)
      void queryClient.invalidateQueries({ queryKey: importsKey })
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
      navigate(`/playlist/${started.playlistId}`)
    } catch (error) {
      showToast(error instanceof DowntifyApiError ? error.message : "Couldn't start the import. Try again.")
    }
  }
}

export function useRetryImport() {
  const credentials = useCredentials()
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  async function retry(entry: PlaylistImport) {
    setRetrying(true)
    try {
      await importApi.retry(credentials, entry.id)
      showToast(`Looking again for ${entry.failed} ${entry.failed === 1 ? 'song' : 'songs'}`)
      await queryClient.invalidateQueries({ queryKey: importsKey })
    } catch (error) {
      showToast(error instanceof DowntifyApiError ? error.message : "Couldn't retry. Try again.")
    } finally {
      setRetrying(false)
    }
  }
  return { retry, retrying }
}

// Keeps the playlist page and Your Library current while songs are being added on the server.
export function useImportProgressRefresh() {
  const queryClient = useQueryClient()
  const { data } = useImports()
  const lastAdded = useRef(new Map<string, number>())

  useEffect(() => {
    if (!data) return
    for (const entry of data) {
      const previous = lastAdded.current.get(entry.id)
      lastAdded.current.set(entry.id, entry.added)
      if (previous === undefined || previous === entry.added) continue
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlist(entry.playlistId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
    }
  }, [data, queryClient])
}
