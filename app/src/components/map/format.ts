// Number formats for the map, legend and panel. `useGrouping: always` is required:
// by default it-IT leaves four-digit numbers ungrouped, so "1234" would sit next to "12.345".
import { copyFor, type Lang } from '../../i18n';
import { nf } from '../../lib/intl';

const grouping = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
const intOptions: Intl.NumberFormatOptions = { ...grouping, maximumFractionDigits: 0 };
const euroOptions: Intl.NumberFormatOptions = {
  ...grouping, style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
};
const percentOptions: Intl.NumberFormatOptions = { style: 'percent', maximumFractionDigits: 1 };

/** The language only reaches these through the store, so the marker follows it separately. */
let missing = copyFor('en').map.notAvailable;
export const setNotAvailable = (lang: Lang): void => { missing = copyFor(lang).map.notAvailable; };
export const notAvailable = (): string => missing;

type Maybe = number | null | undefined;

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const formatInteger = (value: Maybe) => (isNumber(value) ? nf(intOptions).format(value) : missing);

export const formatEuro = (value: Maybe) => (isNumber(value) ? nf(euroOptions).format(value) : missing);

/** A 0-1 share shown as a percentage. */
export const formatShare = (value: Maybe) => (isNumber(value) ? nf(percentOptions).format(value) : missing);

/** A value already expressed on a 0-100 scale. */
export const formatPercentage = (value: Maybe) =>
  (isNumber(value) ? `${nf(intOptions).format(value)}%` : missing);

export const formatMeters = (value: Maybe) => (isNumber(value) ? `${nf(intOptions).format(value)} m` : missing);

export const formatFixed = (value: number, decimals: number) =>
  nf({ ...grouping, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
