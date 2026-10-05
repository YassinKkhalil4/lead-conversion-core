import type { Language } from './types.js';

export interface TemplateVariables {
  lead_name: string;
  company_name: string;
  project_name: string;
}

const DEFAULT_NAMES: Record<Language, { company_name: string; project_name: string }> = {
  English: { company_name: 'our team', project_name: 'our projects' },
  Arabic: { company_name: 'فريقنا', project_name: 'مشاريعنا' },
  Spanish: { company_name: 'nuestro equipo', project_name: 'nuestros locales' },
  Catalan: { company_name: 'el nostre equip', project_name: 'els nostres locals' },
};

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  language: Language,
  /** Further {{placeholders}} a message may carry, e.g. a reservation's party size. */
  extra: Record<string, string> = {},
): string {
  const defaults = DEFAULT_NAMES[language];

  const values: Record<string, string> = {
    lead_name: variables.lead_name,
    company_name: variables.company_name || defaults.company_name,
    project_name: variables.project_name || defaults.project_name,
    ...extra,
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
