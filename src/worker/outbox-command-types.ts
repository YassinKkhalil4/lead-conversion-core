/**
 * Every outbox command type the runtime worker knows how to deliver, grouped by
 * the dispatcher that owns it. Kept free of imports so routing can be decided
 * (and tested) without loading a dispatcher or opening a database pool.
 */
export const WHATSAPP_SEND_COMMAND_TYPE = 'whatsapp.send_message';
export const CALENDAR_CREATE_EVENT_COMMAND_TYPE = 'calendar.create_event';
export const WAITLIST_NOTIFICATION_COMMAND_TYPE = 'waitlist.signup_notification';

export const notificationCommandTypes = [
  'salesperson.lead_assignment_notification',
  'salesperson.sla_assignment_reminder',
  'salesperson.appointment_booked_notification',
  'operator.sla_escalation',
  'operator.daily_report',
  'operator.routing_attention_required',
] as const;

export type NotificationCommandType = typeof notificationCommandTypes[number];

const waitlistCommandTypes = [WAITLIST_NOTIFICATION_COMMAND_TYPE] as const;

export type WaitlistCommandType = typeof waitlistCommandTypes[number];

export function isNotificationCommandType(commandType: string): commandType is NotificationCommandType {
  return (notificationCommandTypes as readonly string[]).includes(commandType);
}

export function isWaitlistCommandType(commandType: string): commandType is WaitlistCommandType {
  return (waitlistCommandTypes as readonly string[]).includes(commandType);
}
