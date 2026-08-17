const { getDefaultConfig } = require('expo/metro-config');

/**
 * Development-only reverse proxy.
 *
 * The deployed API sends no CORS headers, and its session cookie is
 * `HttpOnly; Secure; SameSite=Lax`. A browser therefore cannot call it from the
 * Metro dev origin. Forwarding `/api/*` through the dev server makes the web
 * build same-origin in development, exactly as it will be in production when
 * the built site is served from the same host as the API.
 *
 * This proxy exists only in the dev server. It is not part of any build output,
 * and native builds talk to the API directly.
 */
const API_ORIGIN = process.env.EXPO_PUBLIC_API_ORIGIN || 'https://core.tryrolefit.com';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function forward(request, response) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === 'content-length') continue;
    if (lower === 'accept-encoding') continue;
    if (typeof value === 'string') headers[name] = value;
  }

  const method = request.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);

  const upstream = await fetch(`${API_ORIGIN}${request.url}`, {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  response.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'content-encoding' || lower === 'content-length' || lower === 'set-cookie') return;
    response.setHeader(name, value);
  });

  const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  if (cookies.length > 0) {
    // The dev origin is http://localhost, so a `Secure` cookie would be dropped.
    response.setHeader(
      'set-cookie',
      cookies.map((cookie) => cookie.replace(/;\s*Secure/gi, '')),
    );
  }

  response.end(Buffer.from(await upstream.arrayBuffer()));
}

const config = getDefaultConfig(__dirname);

const enhanceExisting = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhanceExisting ? enhanceExisting(middleware, server) : middleware;
  return (request, response, nextMiddleware) => {
    if (!request.url || !request.url.startsWith('/api/')) {
      return next(request, response, nextMiddleware);
    }
    forward(request, response).catch((error) => {
      response.statusCode = 502;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          ok: false,
          error: 'dev_proxy_unreachable',
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  };
};

module.exports = config;
