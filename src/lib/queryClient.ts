import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      // Queries must still run offline so they can fall back to downloaded data instead of staying paused.
      networkMode: 'always',
      retry: (failureCount) => navigator.onLine && failureCount < 2,
    },
    mutations: { networkMode: 'always' },
  },
})
