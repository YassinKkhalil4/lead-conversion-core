import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { acknowledgeLead } from '@/api/endpoints';

const HOUR = 1000 * 60 * 60;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Salespeople lose signal between viewings, so cached leads stay usable
      // for a week rather than being evicted the moment they go stale.
      staleTime: 30 * 1000,
      gcTime: 24 * 7 * HOUR,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

/**
 * Acknowledgement is the one action a salesperson takes with no signal, so it
 * is registered as a resumable mutation: pressing it offline pauses it, the
 * cache is written to disk, and `resumePausedMutations` replays it on
 * reconnect or after an app restart.
 */
export const ACKNOWLEDGE_MUTATION_KEY = ['lead', 'acknowledge'] as const;

queryClient.setMutationDefaults(ACKNOWLEDGE_MUTATION_KEY, {
  mutationFn: async (leadId: string) => acknowledgeLead(leadId),
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'rolefit.query-cache.v1',
  throttleTime: 1000,
});

export async function clearPersistedCache(): Promise<void> {
  await persister.removeClient();
  queryClient.clear();
}
