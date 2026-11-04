// Italian number formats for the map, legend and panel. `useGrouping: true` is required:
// by default it-IT leaves four-digit numbers ungrouped, so "1234" would sit next to "12.345".
const LOCALE = 'it-IT';
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: true });
const euro = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: true,
});
const percent = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 });

export const NOT_AVAILABLE = 'n.d.';

type Maybe = number | null | undefined;

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const formatInteger = (value: Maybe) => (isNumber(value) ? integer.format(value) : NOT_AVAILABLE);

export const formatEuro = (value: Maybe) => (isNumber(value) ? euro.format(value) : NOT_AVAILABLE);

/** A 0-1 share shown as a percentage. */
export const formatShare = (value: Maybe) => (isNumber(value) ? percent.format(value) : NOT_AVAILABLE);

/** A value already expressed on a 0-100 scale. */
export const formatPercentage = (value: Maybe) =>
  (isNumber(value) ? `${integer.format(value)}%` : NOT_AVAILABLE);

export const formatMeters = (value: Maybe) => (isNumber(value) ? `${integer.format(value)} m` : NOT_AVAILABLE);

export const formatFixed = (value: number, decimals: number) =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true,
  }).format(value);
