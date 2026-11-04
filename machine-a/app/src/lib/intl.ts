/**
 * Number and date formats follow the chosen language.
 *
 * The formatters are built on demand and cached, rather than at module load, because the
 * language can change while the app is running. The store calls setFormatLang whenever it
 * does, and every component that shows a figure also reads a label through useCopy(), so it
 * re-renders and reformats. Tests that assert Italian output call setFormatLang('it').
 */
import { DEFAULT_LANG, LOCALE, type Lang } from '../i18n';

let locale = LOCALE[DEFAULT_LANG];

export const setFormatLang = (lang: Lang): void => { locale = LOCALE[lang]; };
export const formatLocale = (): string => locale;

const numbers = new Map<string, Intl.NumberFormat>();

export function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = numbers.get(key);
  if (cached) return cached;
  const made = new Intl.NumberFormat(locale, options);
  numbers.set(key, made);
  return made;
}

export const longDate = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
