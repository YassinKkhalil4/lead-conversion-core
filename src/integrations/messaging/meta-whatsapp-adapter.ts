import { getEnv } from '../../config/env.js';
import type { MessageProvider, MessagingPayload, SendMessageCommand, SendMessageResult } from './types.js';

type FetchLike = typeof fetch;

export interface MetaWhatsAppConfig {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

function cleanPhone(value: string): string {
  return value.replace(/^\+/, '');
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildMetaPayload(payload: MessagingPayload, toE164: string): Record<string, unknown> {
  const to = cleanPhone(toE164);
  if (payload.kind === 'buttons') {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: truncate(payload.text, 1024) },
        action: {
          buttons: payload.options.slice(0, 3).map((option) => ({
            type: 'reply',
            reply: {
              id: truncate(option.id, 256),
              title: truncate(option.title, 20),
            },
          })),
        },
      },
    };
  }
  if (payload.kind === 'list') {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: truncate(payload.text, 1024) },
        action: {
          button: truncate(payload.buttonText, 20),
          sections: [
            {
              rows: payload.options.slice(0, 10).map((option) => ({
                id: truncate(option.id, 200),
                title: truncate(option.title, 24),
              })),
            },
          ],
        },
      },
    };
  }
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body: payload.text },
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(0, Math.ceil((dateMs - Date.now()) / 1000)), 3600);
  return undefined;
}

function providerError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

function classifyStatus(statusCode: number): 'retryable' | 'permanently_failed' {
  if (statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429) return 'retryable';
  if (statusCode >= 500 && statusCode <= 599) return 'retryable';
  return 'permanently_failed';
}

export class MetaWhatsAppAdapter implements MessageProvider {
  constructor(
    private readonly config: MetaWhatsAppConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  static fromEnv(fetcher: FetchLike = fetch): MetaWhatsAppAdapter {
    const env = getEnv();
    return new MetaWhatsAppAdapter(
      {
        enabled: env.DIRECT_META_SEND_ENABLED,
        accessToken: env.META_WA_ACCESS_TOKEN,
        phoneNumberId: env.META_WA_PHONE_NUMBER_ID,
        graphApiVersion: env.GRAPH_API_VERSION,
      },
      fetcher,
    );
  }

  async send(command: SendMessageCommand): Promise<SendMessageResult> {
    if (!this.config.enabled) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_disabled', providerResponse: {} };
    }
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_credentials_missing', providerResponse: {} };
    }
    if (command.destination.phoneNumberId && command.destination.phoneNumberId !== this.config.phoneNumberId) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_phone_number_id_mismatch', statusCode: 409, providerResponse: {} };
    }

    const endpoint = `https://graph.facebook.com/${this.config.graphApiVersion}/${this.config.phoneNumberId}/messages`;
    try {
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': command.idempotencyKey,
        },
        body: JSON.stringify(buildMetaPayload(command.payload, command.destination.toE164)),
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const providerMessageId = String((body.messages as Array<{ id?: unknown }> | undefined)?.[0]?.id || '');
      if (response.ok && providerMessageId) {
        return { outcome: 'accepted', providerMessageId, providerResponse: body };
      }

      const outcome = classifyStatus(response.status);
      const common = {
        error: providerError(body, providerMessageId ? 'meta_whatsapp_error' : 'meta_whatsapp_no_provider_message_id'),
        statusCode: response.status,
        providerResponse: body,
      };
      if (outcome === 'retryable') {
        const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
        return retryAfterSeconds === undefined ? { outcome, ...common } : { outcome, ...common, retryAfterSeconds };
      }
      return { outcome, ...common };
    } catch (error) {
      return {
        outcome: 'delivery_unknown',
        error: String(error),
        providerResponse: {},
      };
    }
  }
}

export const metaWhatsAppInternals = {
  buildMetaPayload,
  parseRetryAfter,
};
