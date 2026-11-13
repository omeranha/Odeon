import { useStarStore } from '../features/library/stars'
import { usePlayerStore } from '../features/player/playerStore'
import { useProfileStore } from '../features/profiles/profileStore'
import { queryClient } from '../lib/queryClient'

useProfileStore.subscribe((state, previous) => {
  if (state.activeProfileId === previous.activeProfileId) return
  queryClient.clear()
  useStarStore.getState().reset()
  usePlayerStore.getState().clear()
})
