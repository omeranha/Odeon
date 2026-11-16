import clsx from 'clsx'
import type { ReactNode } from 'react'
import { StorageSettings } from '../features/downloads/StorageSettings'
import { useGetMusicEnabled } from '../features/getMusic/hooks'
import { ExplicitRefresh } from '../features/settings/ExplicitRefresh'
import { EqualizerSettings } from '../features/settings/EqualizerSettings'
import { LibraryCleanup } from '../features/settings/LibraryCleanup'
import { PlaybackCacheSettings } from '../features/settings/PlaybackCacheSettings'
import { QualityUpgrade } from '../features/settings/QualityUpgrade'
import { StorageStats } from '../features/settings/StorageStats'
import { SecuritySettings } from '../features/settings/SecuritySettings'
import { UserManagement } from '../features/settings/UserManagement'
import { ProfileAvatar } from '../features/profiles/ProfileAvatar'
import { useCurrentProfile, useProfileStore } from '../features/profiles/profileStore'

export function SettingsPage() {
  const profile = useCurrentProfile()
  const updateSettings = useProfileStore((state) => state.updateSettings)
  const deactivate = useProfileStore((state) => state.deactivate)
  const remove = useProfileStore((state) => state.remove)
  const getMusicEnabled = useGetMusicEnabled()

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-8 text-3xl font-bold">Settings</h1>

      <Section title="Account">
        <div className="flex items-center gap-4 py-2">
          <ProfileAvatar profile={profile} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{profile.displayName}</p>
            <p className="truncate text-sm text-subdued">
              @{profile.username}
              {profile.isAdmin && ' • Administrator'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={deactivate} className="rounded-full border border-white/50 px-5 py-2 text-sm font-bold transition hover:scale-105 hover:border-white">
            Switch profile
          </button>
          <button type="button" onClick={() => remove(profile.id)} className="rounded-full border border-white/50 px-5 py-2 text-sm font-bold transition hover:scale-105 hover:border-white">
            Log out
          </button>
        </div>
      </Section>

      <Section title="Sign-in and security">
        <SecuritySettings />
      </Section>

      {profile.isAdmin && (
        <Section title="Users">
          <UserManagement />
        </Section>
      )}

      {profile.isAdmin && getMusicEnabled && (
        <Section title="Explicit versions">
          <ExplicitRefresh />
        </Section>
      )}

      {profile.isAdmin && getMusicEnabled && (
        <Section title="Better quality">
          <QualityUpgrade />
        </Section>
      )}

      {profile.isAdmin && getMusicEnabled && (
        <Section title="Storage and duplicates">
          <StorageStats />
        </Section>
      )}

      {profile.isAdmin && getMusicEnabled && (
        <Section title="Downloaded songs">
          <LibraryCleanup />
        </Section>
      )}

      <Section title="Playback">
        <SettingRow label="Autoplay" description="When your music ends, keep playing similar songs.">
          <Switch label="Autoplay" checked={profile.settings.autoplay !== false} onChange={(autoplay) => updateSettings(profile.id, { autoplay })} />
        </SettingRow>
        <EqualizerSettings />
      </Section>

      <Section title="Storage">
        <StorageSettings />
        <PlaybackCacheSettings />
      </Section>

      <Section title="About">
        <p className="text-sm text-subdued">Odeon build {new Date(__APP_BUILD__).toLocaleString()}</p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-sm text-subdued">{description}</p>
      </div>
      {children}
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-white/30')}>
      <span className={clsx('absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}
