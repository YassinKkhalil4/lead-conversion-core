import { buildQuery, request } from './client';
import type { Lead, LeadDetail, LeadFilters, LeadPage, Message, User } from './types';

export async function login(input: { email: string; password: string; clientKey?: string }) {
  return request<{ ok: true; token: string; expiresAt: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: input,
  });
}

export async function me() {
  return request<{ ok: true; user: User; expiresAt: string }>('/api/auth/me');
}

export async function logout() {
  return request<{ ok: true; revoked: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function listLeads(filters: LeadFilters, page: { limit: number; offset: number }) {
  const query = buildQuery({
    status: filters.status,
    temperature: filters.temperature,
    source: filters.source,
    assigned_to: filters.assignedTo,
    q: filters.search,
    unacknowledged: filters.unacknowledged ? 'true' : undefined,
    sort: filters.sort ?? 'last_message_at',
    direction: filters.direction ?? 'desc',
    limit: page.limit,
    offset: page.offset,
  });
  return request<{ ok: true } & LeadPage>(`/api/leads${query}`);
}

export async function getLead(leadId: string) {
  return request<{ ok: true } & LeadDetail>(`/api/leads/${leadId}`);
}

export async function getMessages(leadId: string, page: { limit: number; offset: number }) {
  const query = buildQuery({ limit: page.limit, offset: page.offset });
  return request<{ ok: true; messages: Message[]; total: number; limit: number; offset: number }>(
    `/api/leads/${leadId}/messages${query}`,
  );
}

export async function acknowledgeLead(leadId: string) {
  return request<{ ok: true; leadAssignmentId: string; acknowledgedAt: string; slaJobsCancelled: number }>(
    `/api/leads/${leadId}/acknowledge`,
    { method: 'POST' },
  );
}

export async function takeoverLead(leadId: string, enabled: boolean) {
  return request<{ ok: true; humanTakeover: boolean }>(`/api/leads/${leadId}/takeover`, {
    method: 'POST',
    body: { enabled },
  });
}

export async function closeLead(leadId: string, reason: string) {
  return request<{ ok: true; status: string; closedStatus: string }>(`/api/leads/${leadId}/close`, {
    method: 'POST',
    body: { reason },
  });
}

export async function stopFollowUp(leadId: string, reason: string) {
  return request<{ ok: true; stopFollowUp: boolean; followupsCancelled: number }>(
    `/api/leads/${leadId}/stop-followup`,
    { method: 'POST', body: { reason } },
  );
}

export async function replyToLead(
  leadId: string,
  input: {
    requestKey: string;
    payload: { kind: 'text'; text: string } | { kind: 'template'; templateName: string; languageCode: string };
  },
) {
  return request<{ ok: true; messageId: string; outboxCommandId: string; sessionWindowOpen: boolean }>(
    `/api/leads/${leadId}/reply`,
    { method: 'POST', body: input },
  );
}

export type { Lead, LeadDetail, LeadPage, Message, User };
