export interface MessagingDestination {
  channel: 'whatsapp';
  provider: 'meta';
  phoneNumberId: string;
  toE164: string;
}

export interface MessagingInteractiveOption {
  id: string;
  title: string;
}

export type MessagingPayload =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'buttons';
      text: string;
      options: MessagingInteractiveOption[];
    }
  | {
      kind: 'list';
      text: string;
      buttonText: string;
      options: MessagingInteractiveOption[];
    };

export interface SendMessageCommand {
  destination: MessagingDestination;
  payload: MessagingPayload;
  idempotencyKey: string;
}

export type SendMessageResult =
  | {
      outcome: 'accepted';
      providerMessageId: string;
      providerResponse: Record<string, unknown>;
    }
  | {
      outcome: 'retryable';
      error: string;
      statusCode?: number;
      retryAfterSeconds?: number;
      providerResponse: Record<string, unknown>;
    }
  | {
      outcome: 'permanently_failed';
      error: string;
      statusCode?: number;
      providerResponse: Record<string, unknown>;
    }
  | {
      outcome: 'delivery_unknown';
      error: string;
      statusCode?: number;
      providerResponse: Record<string, unknown>;
    };

export interface MessageProvider {
  send(command: SendMessageCommand): Promise<SendMessageResult>;
}
