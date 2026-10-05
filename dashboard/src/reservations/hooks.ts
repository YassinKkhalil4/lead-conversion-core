import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/endpoints';
import type { ReservationFilters, ReservationPage } from '@/api/types';

const PAGE_SIZE = 50;

export const reservationKeys = {
  all: ['reservations'] as const,
  list: (filters: ReservationFilters) => ['reservations', 'list', filters] as const,
  detail: (id: string) => ['reservations', 'detail', id] as const,
  held: ['reservations', 'held'] as const,
};

/** There is no reservation event on the stream, so a list refreshes itself every 30 seconds. */
const REFRESH_MS = 30_000;

export function useReservationList(filters: ReservationFilters) {
  return useInfiniteQuery({
    queryKey: reservationKeys.list(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listReservations(filters, { limit: PAGE_SIZE, offset: pageParam as number }),
    getNextPageParam: (lastPage: ReservationPage) => {
      const loaded = lastPage.offset + lastPage.reservations.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    refetchInterval: REFRESH_MS,
  });
}

/** Requests waiting for the venue's approval, across all dates: what the badge and the top section show. */
export function useHeldReservations() {
  return useQuery({
    queryKey: reservationKeys.held,
    queryFn: () => api.listReservations({ status: ['requested'] }, { limit: 50, offset: 0 }),
    refetchInterval: REFRESH_MS,
  });
}

export function useReservation(id: string) {
  return useQuery({
    queryKey: reservationKeys.detail(id),
    queryFn: () => api.getReservation(id),
    enabled: Boolean(id),
  });
}

/** Every action changes lists and counts, so each one refreshes all reservation queries. */
function useRefreshingMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
    },
  });
}

export const useConfirmReservation = (id: string) =>
  useRefreshingMutation((depositStatus: 'pending' | 'paid' | 'waived' | undefined) => api.confirmReservation(id, depositStatus));

export const useCancelReservation = (id: string) => useRefreshingMutation<void, Awaited<ReturnType<typeof api.cancelReservation>>>(() => api.cancelReservation(id));

export const useSetReservationStatus = (id: string) =>
  useRefreshingMutation((status: 'seated' | 'completed' | 'no_show') => api.setReservationStatus(id, status));
