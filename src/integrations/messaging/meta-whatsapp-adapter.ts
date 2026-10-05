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
  if (payload.kind === 'template') {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: payload.templateName,
        language: { code: payload.languageCode },
        components: payload.components,
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

/**
 * Whether Kadensio sends from this WhatsApp number: an active row in
 * `edge_client_channels` with direct send on. The default number comes from env;
 * every other tenant number (a hospitality venue's own) must be registered here
 * to be sent from, and is sent with the same access token. An unknown id is
 * refused, so a stale or forged command can never pick an arbitrary sender.
 */
export type ChannelLookup = (phoneNumberId: string) => Promise<boolean>;

/** A database-backed lookup, cached for a minute so a busy send loop does not query per message. */
function activeChannelLookup(): ChannelLookup {
  const cache = new Map<string, { ok: boolean; at: number }>();
  return async (phoneNumberId) => {
    const hit = cache.get(phoneNumberId);
    if (hit && Date.now() - hit.at < 60_000) return hit.ok;
    const { pool } = await import('../../db/pool.js');
    const result = await pool.query(
      'SELECT 1 FROM edge_client_channels WHERE phone_number_id=$1 AND active=true AND direct_send_enabled=true',
      [phoneNumberId],
    );
    const ok = (result.rowCount ?? 0) > 0;
    cache.set(phoneNumberId, { ok, at: Date.now() });
    return ok;
  };
}

export class MetaWhatsAppAdapter implements MessageProvider {
  constructor(
    private readonly config: MetaWhatsAppConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly sendableChannel: ChannelLookup = async () => false,
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
      activeChannelLookup(),
    );
  }

  async send(command: SendMessageCommand): Promise<SendMessageResult> {
    if (!this.config.enabled) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_disabled', providerResponse: {} };
    }
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_credentials_missing', providerResponse: {} };
    }
    const requested = command.destination.phoneNumberId;
    if (requested && requested !== this.config.phoneNumberId && !(await this.sendableChannel(requested))) {
      return { outcome: 'permanently_failed', error: 'meta_whatsapp_phone_number_id_mismatch', statusCode: 409, providerResponse: {} };
    }
    const senderId = requested || this.config.phoneNumberId;

    const endpoint = `https://graph.facebook.com/${this.config.graphApiVersion}/${senderId}/messages`;
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
