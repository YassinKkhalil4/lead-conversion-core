import type { BaseLanguage, CompiledConfig, Language, LocalizedText } from './types.js';

export const LANGUAGES: readonly Language[] = ['Arabic', 'English', 'Spanish', 'Catalan'];

/** The two languages every published config carries. Real-estate tenants offer exactly these. */
export const DEFAULT_LANGUAGES: readonly Language[] = ['English', 'Arabic'];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** The languages a tenant offers, in the order the buttons are shown. */
export function configLanguages(config: CompiledConfig): readonly Language[] {
  return config.languages && config.languages.length > 0 ? config.languages : DEFAULT_LANGUAGES;
}

/**
 * The language used when a guest has not chosen one. Real estate has always
 * answered in Arabic first; a tenant that configures `languages` starts with
 * the first of them.
 */
export function defaultLanguage(config: Pick<CompiledConfig, 'languages'>): Language {
  return config.languages?.[0] ?? 'Arabic';
}

/**
 * The text in `language`, falling back to English and then Arabic. Configs
 * published before Spanish and Catalan existed carry only those two, so a
 * missing translation must degrade, not render an empty message.
 */
export function localized(texts: LocalizedText | undefined, language: Language): string {
  if (!texts) return '';
  return texts[language] || texts.English || texts.Arabic || '';
}

export const asBase = (language: Language): BaseLanguage => (language === 'Arabic' ? 'Arabic' : 'English');
