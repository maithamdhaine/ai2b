import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LANG, LANGS, copyFor, isLang, type Copy } from './i18n';
import { setFormatLang } from './lib/intl';
import { formatEur, formatInt } from './components/planner/format';
import { setNotAvailable } from './components/map/format';

/** Every leaf of the dictionary, as a path, so the two languages can be compared. */
function leaves(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}()`];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [path];
}

afterEach(() => {
  setFormatLang(DEFAULT_LANG);
  setNotAvailable(DEFAULT_LANG);
});

describe('the dictionary', () => {
  it('ships English by default, with Italian beside it', () => {
    expect(DEFAULT_LANG).toBe('en');
    expect(LANGS).toEqual(['en', 'it']);
  });

  it('says the same things in both languages', () => {
    const en = leaves(copyFor('en')).sort();
    const it = leaves(copyFor('it')).sort();
    expect(it).toEqual(en);
    expect(en.length).toBeGreaterThan(150);
  });

  it('leaves no English string sitting in the Italian copy, or the other way round', () => {
    const marker = (lang: 'en' | 'it', text: string) => text === copyFor(lang).lang;
    expect(marker('en', copyFor('en').lang)).toBe(true);
    expect(copyFor('it').planner.generateMemo).toBe('Genera memo');
    expect(copyFor('en').planner.generateMemo).toBe('Generate memo');
    expect(copyFor('it').app.mockBanner).toBe('DATI DI PROVA');
  });

  it('falls back to the default language for anything unknown', () => {
    expect(copyFor('fr' as 'en')).toBe(copyFor(DEFAULT_LANG));
    expect(isLang('it')).toBe(true);
    expect(isLang('fr')).toBe(false);
  });

  it('never calls the output SROI, in either language', () => {
    for (const lang of LANGS) {
      const all = JSON.stringify(copyFor(lang), (_key, value: unknown) =>
        (typeof value === 'function' ? String(value) : value));
      expect(all.toLowerCase()).not.toContain('sroi');
    }
  });

  it('keeps the term for the index exact in both languages', () => {
    expect(copyFor('it').planner.metrics.index).toBe('indice di ritorno atteso');
    expect(copyFor('en').planner.metrics.index).toBe('expected return index');
  });
});

describe('number formats follow the language', () => {
  it('groups and places the euro sign the way each locale does', () => {
    setFormatLang('en');
    expect(formatInt(1234567).replace(/ /g, ' ')).toBe('1,234,567');
    expect(formatEur(100000).replace(/ /g, ' ')).toBe('€100,000');

    setFormatLang('it');
    expect(formatInt(1234567).replace(/ /g, ' ')).toBe('1.234.567');
    expect(formatEur(100000).replace(/ /g, ' ')).toBe('100.000 €');
  });

  it('groups four-digit numbers in both, which it-IT leaves bare by default', () => {
    setFormatLang('en');
    expect(formatInt(9500).replace(/ /g, ' ')).toBe('9,500');
    setFormatLang('it');
    expect(formatInt(9500).replace(/ /g, ' ')).toBe('9.500');
  });
});

describe('the copy of a language', () => {
  it('is one object per language, reused rather than rebuilt', () => {
    const first: Copy = copyFor('it');
    expect(copyFor('it')).toBe(first);
  });
});
