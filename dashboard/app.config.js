/**
 * Dynamic Expo config layered over app.json.
 *
 * The production web build is served from https://core.tryrolefit.com/app so
 * that it shares an origin with the API at /api/*. Sharing the origin is what
 * lets the existing HttpOnly, Secure, SameSite=Lax session cookie keep working
 * with no CORS configuration on the server.
 *
 * `experiments.baseUrl` rewrites every asset and route URL to sit under that
 * prefix, so it is set only when EXPO_WEB_BASE_URL is present — that is, only
 * by `npm run build:web`. The dev server deliberately stays at "/" so the
 * Metro /api proxy and local route matching are unaffected.
 */
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_WEB_BASE_URL;
  if (!baseUrl) return config;

  return {
    ...config,
    experiments: {
      ...(config.experiments ?? {}),
      baseUrl,
    },
  };
};
