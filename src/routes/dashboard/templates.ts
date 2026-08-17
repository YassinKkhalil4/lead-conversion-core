import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseApprovedTemplates } from '../../config/approved-templates.js';
import { getEnv } from '../../config/env.js';
import { requireUser } from './context.js';

/**
 * The approved WhatsApp templates, so the reply composer can offer a picker
 * once the 24-hour session window has closed and free-form text is refused.
 *
 * The allow-list is deployment configuration rather than per-client data, so
 * this is the same for every session. It still requires one: the list is not
 * public.
 */
export async function dashboardTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', async (request: FastifyRequest) => {
    requireUser(request);
    const env = getEnv();
    const templates = parseApprovedTemplates(
      env.META_APPROVED_TEMPLATE_NAMES,
      env.META_DEFAULT_TEMPLATE_LANGUAGE,
    );
    return { ok: true, templates, defaultLanguageCode: env.META_DEFAULT_TEMPLATE_LANGUAGE };
  });
}
