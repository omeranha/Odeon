import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router'
import { ping } from '../../lib/subsonic/api'
import { SubsonicError } from '../../lib/subsonic/client'
import { credentialsOf, useActiveProfile, useProfileStore, type Profile } from './profileStore'

export function RequireProfile() {
  const profile = useActiveProfile()
  const hasProfiles = useProfileStore((state) => state.profiles.length > 0)

  if (!profile) return <Navigate to={hasProfiles ? '/profiles' : '/login'} replace />
  return <ActiveSession profile={profile} />
}

// A stored token stops working when the user's password changes in Navidrome. Network errors are ignored so offline use keeps working.
function ActiveSession({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const deactivate = useProfileStore((state) => state.deactivate)
  const { error } = useQuery({
    queryKey: ['session', profile.id],
    queryFn: ({ signal }) => ping(credentialsOf(profile), signal).then(() => true),
    retry: false,
  })

  useEffect(() => {
    if (!(error instanceof SubsonicError) || !error.isAuthError) return
    navigate(`/login?username=${encodeURIComponent(profile.username)}&expired`, { replace: true })
    deactivate()
  }, [error, profile.username, navigate, deactivate])

  return <Outlet />
}
