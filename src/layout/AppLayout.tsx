import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useActivityTracking } from '../features/history/useActivityTracking'
import { LyricsPanel } from '../features/lyrics/LyricsPanel'
import { usePlayerEngine } from '../features/player/audioEngine'
import { useEqualizerEngine } from '../features/player/equalizer'
import { FullScreenPlayer } from '../features/player/FullScreenPlayer'
import { MiniPlayer } from '../features/player/MiniPlayer'
import { PlayerBar } from '../features/player/PlayerBar'
import { QueuePanel } from '../features/player/QueuePanel'
import { useTransport } from '../features/player/transport'
import { AddToPlaylistDialog } from '../features/playlists/AddToPlaylistDialog'
import { DevicePicker } from '../features/remote/RemoteDevices'
import { useRefreshChangedDownloads } from '../features/downloads/refreshChanged'
import { useRemoteSession } from '../features/remote/session'
import { useQueueSuggestions } from '../features/recommendations/useQueueSuggestions'
import { useGetMusicEnabled, useLibraryRefreshOnDownloads } from '../features/getMusic/hooks'
import { useImportProgressRefresh } from '../features/getMusic/imports'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

function DownloadWatcher() {
  useLibraryRefreshOnDownloads(useGetMusicEnabled())
  useImportProgressRefresh()
  useRefreshChangedDownloads()
  return null
}

export function AppLayout() {
  usePlayerEngine()
  useEqualizerEngine()
  useRemoteSession()
  useQueueSuggestions()
  useActivityTracking()
  const hasSong = Boolean(useTransport().song)
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="flex h-dvh flex-col bg-app md:gap-2 md:p-2">
      <TopBar />
      <div className="flex min-h-0 flex-1 md:gap-2">
        <Sidebar />
        <main ref={mainRef} className={clsx('relative min-w-0 flex-1 overflow-y-auto bg-surface pt-[env(safe-area-inset-top)] md:rounded-lg md:pt-0 md:pb-0', hasSong ? 'pb-[calc(8.5rem+var(--nav-inset))]' : 'pb-[calc(5rem+var(--nav-inset))]')}>
          <Outlet />
        </main>
        <QueuePanel />
        <LyricsPanel />
      </div>
      <PlayerBar />
      <MiniPlayer />
      <DevicePicker />
      <BottomNav />
      <FullScreenPlayer />
      <AddToPlaylistDialog />
      <DownloadWatcher />
    </div>
  )
}
