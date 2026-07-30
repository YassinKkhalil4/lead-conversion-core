import { getEnv } from '../config/env.js';
import type { ReplyDecision } from '../domain/types.js';

export interface MetaSendResult {
  ok: boolean;
  statusCode: number;
  providerMessageId: string;
  response: Record<string, unknown>;
  error: string;
}

function buildPayload(to: string, decision: ReplyDecision): Record<string, unknown> {
  const cleanTo = String(to).replace(/^\+/, '');
  const options = decision.interactiveOptions || [];
  if (decision.messageKind === 'buttons' && options.length > 0 && options.length <= 3) {
    return {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: decision.text.slice(0, 1024) },
        action: {
          buttons: options.map((option) => ({
            type: 'reply',
            reply: { id: option.id.slice(0, 256), title: option.label.slice(0, 20) },
          })),
        },
      },
    };
  }
  if ((decision.messageKind === 'list' || options.length > 3) && options.length > 0) {
    const english = !/[\u0600-\u06ff]/.test(options.map((o) => o.label).join(' '));
    return {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: decision.text.slice(0, 1024) },
        action: {
          button: english ? 'View options' : 'عرض الخيارات',
          sections: [{
            rows: options.slice(0, 10).map((option) => ({
              id: option.id.slice(0, 200),
              title: option.label.slice(0, 24),
            })),
          }],
        },
      },
    };
  }
  return {
    messaging_product: 'whatsapp',
    to: cleanTo,
    type: 'text',
    text: { preview_url: false, body: decision.text },
  };
}

export class MetaSender {
  private readonly env = getEnv();

  async send(input: {
    phoneNumberId: string;
    to: string;
    decision: ReplyDecision;
  }): Promise<MetaSendResult> {
    if (!this.env.DIRECT_META_SEND_ENABLED) {
      return { ok: false, statusCode: 503, providerMessageId: '', response: {}, error: 'direct_meta_send_disabled' };
    }
    const configuredPhoneId = this.env.META_WA_PHONE_NUMBER_ID;
    if (!this.env.META_WA_ACCESS_TOKEN || !configuredPhoneId) {
      return { ok: false, statusCode: 503, providerMessageId: '', response: {}, error: 'meta_credentials_missing' };
    }
    if (input.phoneNumberId && input.phoneNumberId !== configuredPhoneId) {
      return { ok: false, statusCode: 409, providerMessageId: '', response: {}, error: 'phone_number_id_mismatch' };
    }
    const endpoint = `https://graph.facebook.com/${this.env.GRAPH_API_VERSION}/${configuredPhoneId}/messages`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.env.META_WA_ACCESS_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildPayload(input.to, input.decision)),
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, any>;
      const providerMessageId = String(body.messages?.[0]?.id || '');
      const ok = response.ok && !body.error && providerMessageId.length > 0;
      return {
        ok,
        statusCode: response.status,
        providerMessageId,
        response: body,
        error: ok ? '' : String(body.error?.message || 'no_provider_message_id'),
      };
    } catch (error) {
      return { ok: false, statusCode: 599, providerMessageId: '', response: {}, error: String(error) };
    }
  }
}
