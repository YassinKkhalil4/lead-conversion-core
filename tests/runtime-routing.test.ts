import { describe, expect, it } from 'vitest';
import type { ClaimedJob, ClaimedOutboxCommand } from '../src/infrastructure/runtime.js';
import { createJobRouter, createOutboxRouter } from '../src/worker/runtime-routing.js';
import type { OutboxDispatchResult } from '../src/worker/runtime-worker.js';

function command(commandType: string): ClaimedOutboxCommand {
  return {
    outboxCommandId: '00000000-0000-4000-8000-000000000001',
    workerId: 'routing-test',
    commandType,
    destination: 'x',
    idempotencyKey: `routing:${commandType}`,
    attemptCount: 1,
    payload: {},
  };
}

function job(jobType: string): ClaimedJob {
  return { scheduledJobId: 'job-1', workerId: 'routing-test', jobType, attemptCount: 1, payload: {} };
}

function recorder(name: string) {
  const seen: string[] = [];
  return {
    seen,
    dispatch: async (claimed: ClaimedOutboxCommand): Promise<OutboxDispatchResult> => {
      seen.push(claimed.commandType);
      return { outcome: 'delivered', providerMessageId: name };
    },
  };
}

describe('outbox routing', () => {
  it('sends each command family to its own dispatcher', async () => {
    const messaging = recorder('messaging');
    const calendar = recorder('calendar');
    const notification = recorder('notification');
    const waitlist = recorder('waitlist');
    const route = createOutboxRouter({ messaging, calendar, notification, waitlist });

    await route(command('whatsapp.send_message'));
    await route(command('calendar.create_event'));
    await route(command('salesperson.lead_assignment_notification'));
    await route(command('operator.daily_report'));
    await route(command('waitlist.signup_notification'));

    expect(messaging.seen).toEqual(['whatsapp.send_message']);
    expect(calendar.seen).toEqual(['calendar.create_event']);
    expect(notification.seen).toEqual(['salesperson.lead_assignment_notification', 'operator.daily_report']);
    expect(waitlist.seen).toEqual(['waitlist.signup_notification']);
  });

  it('fails an unknown command where it was routed, not in the WhatsApp sender', async () => {
    const messaging = recorder('messaging');
    const route = createOutboxRouter({ messaging, notification: recorder('n'), waitlist: recorder('w') });

    await expect(route(command('crm.sync_contact'))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'unsupported_outbox_command:crm.sync_contact',
    });
    expect(messaging.seen).toEqual([]);
  });

  it('names the disabled dispatcher when a known family has none configured', async () => {
    const route = createOutboxRouter({ notification: recorder('n'), waitlist: recorder('w') });

    await expect(route(command('whatsapp.send_message'))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'messaging_dispatcher_disabled',
    });
    await expect(route(command('calendar.create_event'))).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'calendar_dispatcher_disabled',
    });
  });
});

describe('scheduled job routing', () => {
  it('runs the processor registered for the job type', async () => {
    const seen: string[] = [];
    const route = createJobRouter({
      'sla.notify': async (claimed) => {
        seen.push(claimed.jobType);
        return { outcome: 'completed' };
      },
    });

    await expect(route(job('sla.notify'))).resolves.toEqual({ outcome: 'completed' });
    expect(seen).toEqual(['sla.notify']);
  });

  it('dead-letters a job type nothing is registered for', async () => {
    const route = createJobRouter({});

    await expect(route(job('invoice.send'))).resolves.toEqual({
      outcome: 'dead_lettered',
      reason: 'unsupported_scheduled_job:invoice.send',
    });
  });
});
