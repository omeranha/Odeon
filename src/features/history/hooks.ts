import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { activityApi } from '../../lib/activity'
import { isMusicLink } from '../../lib/downtify'
import { useDebouncedValue } from '../../lib/hooks'
import { useCredentials } from '../library/queries'
import { credentialsOf, useCurrentProfile } from '../profiles/profileStore'

export const historyKeys = {
  plays: ['activity', 'plays'] as const,
  searches: ['activity', 'searches'] as const,
  usage: ['activity', 'usage'] as const,
}

const PLAYS_SHOWN = 100
// Searches are saved once the text stops changing, so half-typed words don't pile up.
const SEARCH_SETTLE_MS = 1500
const MIN_SEARCH_LENGTH = 2

export function useRecentPlays() {
  const credentials = useCredentials()
  return useQuery({ queryKey: historyKeys.plays, queryFn: () => activityApi.plays(credentials, PLAYS_SHOWN), retry: false })
}

export function useRecentSearches() {
  const credentials = useCredentials()
  return useQuery({ queryKey: historyKeys.searches, queryFn: () => activityApi.searches(credentials), retry: false })
}

export function useListeningUsage() {
  const credentials = useCredentials()
  return useQuery({ queryKey: historyKeys.usage, queryFn: () => activityApi.usage(credentials), retry: false })
}

export function useRecordSearch(query: string) {
  const profile = useCurrentProfile()
  const queryClient = useQueryClient()
  const settled = useDebouncedValue(query, SEARCH_SETTLE_MS).trim()

  useEffect(() => {
    if (settled.length < MIN_SEARCH_LENGTH || isMusicLink(settled)) return
    activityApi
      .addSearch(credentialsOf(profile), settled)
      .then(() => queryClient.invalidateQueries({ queryKey: historyKeys.searches }))
      .catch(() => undefined)
  }, [settled, profile, queryClient])
}

export function useHistoryActions() {
  const credentials = useCredentials()
  const queryClient = useQueryClient()
  const refresh = (key: readonly string[]) => queryClient.invalidateQueries({ queryKey: key })

  return {
    removeSearch: (query: string) => activityApi.removeSearch(credentials, query).then(() => refresh(historyKeys.searches)),
    clearSearches: () => activityApi.clearSearches(credentials).then(() => refresh(historyKeys.searches)),
    clearPlays: () => activityApi.clearPlays(credentials).then(() => refresh(historyKeys.plays)),
  }
}
