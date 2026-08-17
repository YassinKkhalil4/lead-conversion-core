export interface ApprovedTemplate {
  name: string;
  languageCode: string;
}

/**
 * `META_APPROVED_TEMPLATE_NAMES` is a comma-separated allow-list. It carried
 * only names, but a WhatsApp template is identified by name *and* language, and
 * the reply composer has to send both.
 *
 * The format is therefore `name` or `name:language`. A bare name takes
 * `META_DEFAULT_TEMPLATE_LANGUAGE`, so every existing deployment keeps working
 * unchanged and only needs editing to add a second language for a template.
 */
export function parseApprovedTemplates(raw: string, defaultLanguage: string): ApprovedTemplate[] {
  const seen = new Set<string>();
  const templates: ApprovedTemplate[] = [];

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf(':');
    const name = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
    const languageCode = (separator === -1 ? '' : trimmed.slice(separator + 1)).trim() || defaultLanguage;
    if (!name) continue;

    const key = `${name}:${languageCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({ name, languageCode });
  }

  return templates;
}

/**
 * The names alone, for send-policy validation. A template is approved by name
 * regardless of which language variant the caller asks for, because Meta
 * approves the template and its translations together.
 */
export function approvedTemplateNames(raw: string, defaultLanguage: string): string[] {
  const names = new Set(parseApprovedTemplates(raw, defaultLanguage).map((template) => template.name));
  return [...names];
}
