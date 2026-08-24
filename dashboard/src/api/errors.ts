import { ApiError } from './client';

export interface Explained {
  title: string;
  detail: string;
}

/**
 * Every failure gets a specific cause and a next step. There is deliberately no
 * generic fallback copy such as "Something went wrong": the last resort still
 * names the status code and what to do about it.
 */
export function explain(error: unknown, context: string): Explained {
  if (!(error instanceof ApiError)) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      title: `${context} failed unexpectedly`,
      detail: `The app hit an error it does not recognise: ${detail}. Reload the screen; if it repeats, send this message to whoever runs the server.`,
    };
  }

  if (error.isOffline) {
    return {
      title: 'No connection to the server',
      detail: `${context} could not reach the Kadensio server. Check your signal — anything you have already loaded is still readable, and queued actions will be sent when you are back online.`,
    };
  }

  switch (error.code) {
    case 'invalid_credentials':
      return {
        title: 'Email or password is wrong',
        detail: 'Check both and try again. Accounts are created by an admin, so there is no password reset here yet — ask your admin if you are locked out.',
      };
    case 'login_rate_limited': {
      const seconds = Number(error.details.retryAfterSeconds ?? 0);
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return {
        title: 'Too many sign-in attempts',
        detail: `The server is blocking sign-in from this device for about ${minutes} minute${minutes === 1 ? '' : 's'}. Wait, then try again with the correct password.`,
      };
    }
    case 'unauthenticated':
      return {
        title: 'Your session has expired',
        detail: 'Sessions last 30 days. Sign in again to carry on.',
      };
    case 'role_not_permitted':
      return {
        title: 'Your role cannot do that',
        detail: 'This action is limited to managers and admins. Ask a manager to do it, or to change your role.',
      };
    case 'lead_not_found':
      return {
        title: 'That lead is not visible to you',
        detail: 'It was either reassigned to another salesperson or belongs to a different company. Go back to the inbox and pull to refresh.',
      };
    case 'lead_has_no_active_assignment':
      return {
        title: 'Nothing to acknowledge',
        detail: 'This lead has no open assignment — it may already have been acknowledged or closed. Pull to refresh to see its current state.',
      };
    case 'assignment_belongs_to_another_salesperson':
      return {
        title: 'This assignment is not yours',
        detail: 'Another salesperson holds it now. You can still read the lead, but only the assigned person can acknowledge it.',
      };
    case 'session_window_closed':
      return {
        title: 'The 24-hour reply window has closed',
        detail: 'WhatsApp only accepts free-form text within 24 hours of the lead\'s last message. Send an approved template instead — that reopens the window when they reply.',
      };
    case 'template_not_approved':
      return {
        title: 'That template is not approved',
        detail: `Meta has not approved "${String(error.details.templateName ?? 'this template')}" for this number. Pick one from the approved list.`,
      };
    case 'validation_failed':
      return {
        title: `${context} was rejected as invalid`,
        detail: 'The server refused the values sent. This is a bug in the app rather than something you did — please report it.',
      };
    case 'dev_proxy_unreachable':
      return {
        title: 'The development proxy could not reach the API',
        detail: `${String(error.details.detail ?? 'The upstream request failed.')} Confirm the Kadensio server is reachable from this machine.`,
      };
    default:
      break;
  }

  if (error.status >= 500) {
    return {
      title: `The server failed while ${context.toLowerCase()}`,
      detail: `It returned ${error.status} (${error.code}). This is a server-side fault, not something you can fix here — retry in a moment, and report it if it persists.`,
    };
  }

  return {
    title: `${context} was refused`,
    detail: `The server returned ${error.status} (${error.code}). Retry, and report it if it keeps happening.`,
  };
}
