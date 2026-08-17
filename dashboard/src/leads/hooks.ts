import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/endpoints';
import type { LeadDetail, LeadFilters, LeadPage } from '@/api/types';
import { ACKNOWLEDGE_MUTATION_KEY } from '@/query/client';

const PAGE_SIZE = 25;

export const leadKeys = {
  all: ['leads'] as const,
  list: (filters: LeadFilters) => ['leads', 'list', filters] as const,
  detail: (leadId: string) => ['leads', 'detail', leadId] as const,
};

export function useLeadList(filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: leadKeys.list(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listLeads(filters, { limit: PAGE_SIZE, offset: pageParam as number }),
    getNextPageParam: (lastPage: LeadPage) => {
      const loaded = lastPage.offset + lastPage.leads.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
}

export function useLeadDetail(leadId: string) {
  return useQuery({
    queryKey: leadKeys.detail(leadId),
    queryFn: () => api.getLead(leadId),
    enabled: Boolean(leadId),
  });
}

/**
 * Optimistic and resumable. Pressing acknowledge with no signal updates the
 * cached lead immediately and leaves the mutation paused until reconnect.
 */
export function useAcknowledge(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ACKNOWLEDGE_MUTATION_KEY,
    mutationFn: (id: string) => api.acknowledgeLead(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: leadKeys.detail(id) });
      const previous = queryClient.getQueryData<LeadDetail>(leadKeys.detail(id));
      const acknowledgedAt = new Date().toISOString();
      queryClient.setQueryData<LeadDetail>(leadKeys.detail(id), (current) =>
        current && current.lead.assignment
          ? {
              ...current,
              lead: { ...current.lead, assignment: { ...current.lead.assignment, acknowledgedAt } },
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, id, context) => {
      if (context?.previous) queryClient.setQueryData(leadKeys.detail(id), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
    scope: { id: `acknowledge-${leadId}` },
  });
}

export function useTakeover(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.takeoverLead(leadId, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
    },
  });
}

export function useCloseLead(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.closeLead(leadId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useStopFollowUp(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.stopFollowUp(leadId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
    },
  });
}

export function useReply(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.replyToLead>[1]) => api.replyToLead(leadId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
    },
  });
}
