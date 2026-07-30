import type { Language } from './types.js';

export interface TemplateVariables {
  lead_name: string;
  company_name: string;
  project_name: string;
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
  language: Language,
): string {
  const defaults =
    language === 'English'
      ? { company_name: 'our team', project_name: 'our projects' }
      : { company_name: 'فريقنا', project_name: 'مشاريعنا' };

  const values: Record<string, string> = {
    lead_name: variables.lead_name,
    company_name: variables.company_name || defaults.company_name,
    project_name: variables.project_name || defaults.project_name,
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
