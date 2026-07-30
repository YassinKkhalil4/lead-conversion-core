import { describe, expect, it, vi } from 'vitest';
import { MessagingOutboxDispatcher } from '../src/worker/messaging-outbox-dispatcher.js';
import type { ClaimedOutboxCommand } from '../src/infrastructure/runtime.js';
import type { MessageProvider } from '../src/integrations/messaging/types.js';

function command(overrides: Partial<ClaimedOutboxCommand> = {}): ClaimedOutboxCommand {
  return {
    outboxCommandId: '6f5f5aa4-21e3-4877-b844-ccdc3563e21b',
    commandType: 'whatsapp.send_message',
    destination: '+201000000001',
    idempotencyKey: 'message:lead-1:welcome',
    attemptCount: 1,
    payload: {
      provider: 'meta',
      phoneNumberId: 'phone-number-id-test',
      toE164: '+201000000001',
      message: {
        kind: 'text',
        text: 'Welcome',
      },
    },
    ...overrides,
  };
}

describe('MessagingOutboxDispatcher', () => {
  it('maps accepted provider sends to delivered outbox outcomes', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.sanitized.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.sanitized.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith({
      destination: {
        channel: 'whatsapp',
        provider: 'meta',
        phoneNumberId: 'phone-number-id-test',
        toE164: '+201000000001',
      },
      payload: { kind: 'text', text: 'Welcome' },
      idempotencyKey: 'message:lead-1:welcome',
    });
  });

  it('preserves retry hints from retryable provider outcomes', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'retryable' as const,
        error: 'Application request limit reached',
        retryAfterSeconds: 17,
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'retryable',
      error: 'Application request limit reached',
      retryAfterSeconds: 17,
    });
  });

  it('rejects unsupported command types without calling the provider', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.should-not-send',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({ commandType: 'calendar.create_event' }))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'unsupported_outbox_command:calendar.create_event',
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('rejects malformed send payloads without calling the provider', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.should-not-send',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    const result = await dispatcher.dispatch(command({ payload: { message: { kind: 'text', text: '' } } }));
    expect(result.outcome).toBe('permanently_failed');
    if (result.outcome !== 'permanently_failed') throw new Error('expected_permanent_failure');
    expect(result.error).toContain('invalid_whatsapp_send_payload');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('maps salesperson assignment notifications to real WhatsApp sends', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.assignment.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({
      commandType: 'salesperson.lead_assignment_notification',
      destination: '+201044444444',
      idempotencyKey: 'salesperson.notify:assignment-1',
      payload: {
        leadId: '11111111-1111-4111-8111-111111111111',
        routingRunId: '22222222-2222-4222-8222-222222222222',
        assignmentId: '33333333-3333-4333-8333-333333333333',
        salespersonId: '44444444-4444-4444-8444-444444444444',
        clientId: '55555555-5555-4555-8555-555555555555',
        contactName: 'Lead Name',
        contactPhoneE164: '+201099999999',
        projectName: 'Project Name',
        leadScore: 91,
        temperature: 'hot',
      },
    }))).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.assignment.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      destination: expect.objectContaining({ toE164: '+201044444444' }),
      payload: expect.objectContaining({
        kind: 'text',
        text: expect.stringContaining('New lead assigned.'),
      }),
      idempotencyKey: 'salesperson.notify:assignment-1',
    }));
  });

  it('maps SLA assignment reminders to real WhatsApp sends', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.sla.reminder.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({
      commandType: 'salesperson.sla_assignment_reminder',
      destination: '+201044444444',
      idempotencyKey: 'sla.notify:11111111-1111-4111-8111-111111111111',
      payload: {
        slaJobId: '11111111-1111-4111-8111-111111111111',
        leadId: '22222222-2222-4222-8222-222222222222',
        assignmentId: '33333333-3333-4333-8333-333333333333',
        salespersonId: '44444444-4444-4444-8444-444444444444',
        contactName: 'Lead Name',
        contactPhoneE164: '+201099999999',
      },
    }))).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.sla.reminder.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      destination: expect.objectContaining({ toE164: '+201044444444' }),
      payload: expect.objectContaining({
        kind: 'text',
        text: expect.stringContaining('Lead assignment still needs acknowledgement.'),
      }),
      idempotencyKey: 'sla.notify:11111111-1111-4111-8111-111111111111',
    }));
  });

  it('maps SLA escalations to real WhatsApp sends', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.sla.escalation.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({
      commandType: 'operator.sla_escalation',
      destination: '+201099900001',
      idempotencyKey: 'sla.notify:55555555-5555-4555-8555-555555555555',
      payload: {
        slaJobId: '55555555-5555-4555-8555-555555555555',
        slaType: 'stale_qualified_escalation',
        leadId: '22222222-2222-4222-8222-222222222222',
        contactName: 'Lead Name',
        contactPhoneE164: '+201099999999',
        reason: 'stale_qualified_lead',
      },
    }))).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.sla.escalation.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      destination: expect.objectContaining({ toE164: '+201099900001' }),
      payload: expect.objectContaining({
        kind: 'text',
        text: expect.stringContaining('SLA escalation.'),
      }),
      idempotencyKey: 'sla.notify:55555555-5555-4555-8555-555555555555',
    }));
  });

  it('maps daily reports to real WhatsApp sends', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.report.accepted',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({
      commandType: 'operator.daily_report',
      destination: '+201099900001',
      idempotencyKey: 'report.daily:11111111-1111-4111-8111-111111111111',
      payload: {
        dailyReportId: '11111111-1111-4111-8111-111111111111',
        clientId: '22222222-2222-4222-8222-222222222222',
        companyName: 'Report Client',
        reportDate: '2026-07-30',
        timezone: 'Africa/Cairo',
        summary: {
          leadIntakeCount: 2,
          newLeadCount: 2,
          qualifiedLeadCount: 1,
          assignedLeadCount: 1,
          acknowledgedAssignmentCount: 1,
          unacknowledgedActiveAssignmentCount: 0,
          slaEscalationCount: 0,
          followupSentCount: 3,
          followupCancelledCount: 1,
          outboundMessageCount: 5,
          deliveredMessageCount: 4,
          failedMessageCount: 1,
          deadLetterCount: 0,
        },
      },
    }))).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'wamid.report.accepted',
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      destination: expect.objectContaining({ toE164: '+201099900001' }),
      payload: expect.objectContaining({
        kind: 'text',
        text: expect.stringContaining('Daily report for Report Client'),
      }),
      idempotencyKey: 'report.daily:11111111-1111-4111-8111-111111111111',
    }));
  });

  it('rejects malformed notification payloads without calling the provider', async () => {
    const provider: MessageProvider = {
      send: vi.fn(async () => ({
        outcome: 'accepted' as const,
        providerMessageId: 'wamid.should-not-send',
        providerResponse: {},
      })),
    };
    const dispatcher = new MessagingOutboxDispatcher({ meta: provider });

    await expect(dispatcher.dispatch(command({
      commandType: 'operator.routing_attention_required',
      payload: { reason: 'missing IDs' },
    }))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'invalid_notification_payload:operator.routing_attention_required',
    });
    expect(provider.send).not.toHaveBeenCalled();
  });
});
