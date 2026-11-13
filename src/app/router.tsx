import { createBrowserRouter, Navigate } from 'react-router'
import { InvitePage } from '../features/profiles/InvitePage'
import { LoginPage } from '../features/profiles/LoginPage'
import { ProfilesPage } from '../features/profiles/ProfilesPage'
import { RequireProfile } from '../features/profiles/RequireProfile'
import { AppLayout } from '../layout/AppLayout'
import { AlbumPage } from '../pages/AlbumPage'
import { ArtistPage } from '../pages/ArtistPage'
import { HomePage } from '../pages/HomePage'
import { LibraryPage } from '../pages/LibraryPage'
import { LikedSongsPage } from '../pages/LikedSongsPage'
import { PlaylistPage } from '../pages/PlaylistPage'
import { SearchPage } from '../pages/SearchPage'
import { SettingsPage } from '../pages/SettingsPage'
import { GetMusicPage } from '../pages/GetMusicPage'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'invite/:token', element: <InvitePage /> },
      { path: 'profiles', element: <ProfilesPage /> },
      {
        element: <RequireProfile />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'search', element: <SearchPage /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'collection/tracks', element: <LikedSongsPage /> },
              { path: 'album/:id', element: <AlbumPage /> },
              { path: 'artist/:id', element: <ArtistPage /> },
              { path: 'playlist/:id', element: <PlaylistPage /> },
              { path: 'settings', element: <SettingsPage /> },
              { path: 'get-music', element: <GetMusicPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
