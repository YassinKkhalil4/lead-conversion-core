import { Platform } from 'react-native';
import { readToken } from './session';

/**
 * Web talks to the API through the dev server's same-origin `/api` proxy, so
 * the HttpOnly session cookie is used and no token is ever held in browser
 * JavaScript. Native has no CORS or cookie constraints and sends a bearer token
 * from the device keychain.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? (Platform.OS === 'web' ? '' : 'https://core.tryrolefit.com');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const token = await readToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // Distinguished from a server error so the UI can say "no connection"
    // rather than blaming the server.
    throw new ApiError(0, 'network_unreachable', {
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ApiError(response.status, 'invalid_server_response', { body: text.slice(0, 200) });
    }
  }

  if (!response.ok || payload.ok === false) {
    const code = typeof payload.error === 'string' ? payload.error : `http_${response.status}`;
    throw new ApiError(response.status, code, payload);
  }

  return payload as T;
}

export function buildQuery(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
