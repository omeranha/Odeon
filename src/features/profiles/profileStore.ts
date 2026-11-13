import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubsonicCredentials } from '../../lib/subsonic/client'
import { defaultProfileSettings, type ProfileSettings } from '../settings/profileSettings'

export interface Profile {
  id: string
  username: string
  displayName: string
  isAdmin: boolean
  avatarUrl?: string
  token: string
  salt: string
  settings: ProfileSettings
}

export type ProfileLogin = Omit<Profile, 'settings'>

interface ProfileState {
  profiles: Profile[]
  activeProfileId: string | null
  saveAndActivate: (login: ProfileLogin) => void
  activate: (id: string) => void
  deactivate: () => void
  remove: (id: string) => void
  updateSettings: (id: string, settings: Partial<ProfileSettings>) => void
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profiles: [],
      activeProfileId: null,
      saveAndActivate: (login) =>
        set((state) => {
          const existing = state.profiles.find((profile) => profile.id === login.id)
          const saved: Profile = { ...login, settings: existing?.settings ?? defaultProfileSettings }
          const profiles = existing ? state.profiles.map((profile) => (profile.id === login.id ? saved : profile)) : [...state.profiles, saved]
          return { profiles, activeProfileId: login.id }
        }),
      activate: (id) => set({ activeProfileId: id }),
      deactivate: () => set({ activeProfileId: null }),
      remove: (id) =>
        set((state) => ({
          profiles: state.profiles.filter((profile) => profile.id !== id),
          activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
        })),
      updateSettings: (id, settings) =>
        set((state) => ({
          profiles: state.profiles.map((profile) => (profile.id === id ? { ...profile, settings: { ...profile.settings, ...settings } } : profile)),
        })),
    }),
    { name: 'spotydrome-profiles', version: 1 },
  ),
)

export function useActiveProfile(): Profile | undefined {
  return useProfileStore((state) => state.profiles.find((profile) => profile.id === state.activeProfileId))
}

// Only valid below <RequireProfile>, which guarantees an active profile.
export function useCurrentProfile(): Profile {
  const profile = useActiveProfile()
  if (!profile) throw new Error('useCurrentProfile was called without an active profile')
  return profile
}

export function credentialsOf(profile: Profile): SubsonicCredentials {
  return { username: profile.username, token: profile.token, salt: profile.salt }
}
