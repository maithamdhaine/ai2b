import { copyFor, type Lang } from '../../i18n';
import type { Lens, ServiceType, Weights, ZoneProps } from '../../types';
import { formatFixed, isNumber, notAvailable } from './format';

export const CLASS_COUNT = 5;
export const ZONE_FILL_OPACITY = 0.85;
export const HATCH_ID = 'bussola-hatch';
/** Hatched fill for small zones. The trailing colour is the SVG fallback if the pattern is missing. */
export const HATCH_FILL = `url(#${HATCH_ID}) #f6f4ef`;
export const MISSING_FILL = '#e4e1da';

// One hue per ramp, with even OKLCH lightness steps. The need lenses share the hue of --accent.
// "Già finanziato" is a different kind of fact, so it gets its own hue. Neither ramp is red,
// because a high value means a need, never a danger.
const NEED_RAMP = ['#b7dddf', '#77bcbf', '#3e999d', '#007176', '#00474a'];
const FUNDED_RAMP = ['#edcfaa', '#d3a469', '#b47c2e', '#875806', '#553503'];

/** How a lens is drawn. What it is called lives in i18n.ts. */
export interface LensSpec {
  max: number;
  decimals: number;
  ramp: string[];
}

export const LENSES: Record<Lens, LensSpec> = {
  isolation: { max: 100, decimals: 0, ramp: NEED_RAMP },
  service_gap: { max: 100, decimals: 0, ramp: NEED_RAMP },
  future_pressure: { max: 100, decimals: 0, ramp: NEED_RAMP },
  inclusion: { max: 100, decimals: 0, ramp: NEED_RAMP },
  funded_share: { max: 1, decimals: 2, ramp: FUNDED_RAMP },
};

/** Name, one-line note and the scale sentence, in the chosen language. */
export function lensText(lens: Lens, lang: Lang): { label: string; note: string; scale: string } {
  const t = copyFor(lang).map;
  return {
    ...t.lenses[lens],
    scale: lens === 'funded_share' ? t.fundedScale : t.needScale,
  };
}

export const LENS_ORDER: Lens[] = ['isolation', 'service_gap', 'future_pressure', 'inclusion', 'funded_share'];
export const NEED_LENSES: (keyof Weights)[] = ['isolation', 'service_gap', 'future_pressure', 'inclusion'];

/** The zone's value for a lens. The contract says number, but real files may leave a score empty. */
export function lensValue(zone: ZoneProps, lens: Lens): number | null {
  const value: unknown = zone[lens];
  return isNumber(value) ? value : null;
}

/** Equal-interval class, lower bound inclusive. Out-of-range values clamp to the end classes. */
export function classIndex(value: number, lens: Lens): number {
  const index = Math.floor((value / LENSES[lens].max) * CLASS_COUNT);
  return Math.min(CLASS_COUNT - 1, Math.max(0, index));
}

export function lensClasses(lens: Lens): { label: string; color: string }[] {
  const { max, decimals, ramp } = LENSES[lens];
  const bound = (index: number) => formatFixed((index * max) / CLASS_COUNT, decimals);
  return ramp.map((color, index) => ({ color, label: `${bound(index)}–${bound(index + 1)}` }));
}

export function zoneFill(zone: ZoneProps, lens: Lens): { fillColor: string; fillOpacity: number } {
  if (zone.small_zone) return { fillColor: HATCH_FILL, fillOpacity: 1 };
  const value = lensValue(zone, lens);
  if (value === null) return { fillColor: MISSING_FILL, fillOpacity: ZONE_FILL_OPACITY };
  return { fillColor: LENSES[lens].ramp[classIndex(value, lens)], fillOpacity: ZONE_FILL_OPACITY };
}

/** Reads as "51 su 100" or "51 of 100", so the index is never mistaken for a percentage of funding. */
export function formatLensValue(value: number | null, lens: Lens, lang: Lang): string {
  if (value === null) return notAvailable();
  const { max, decimals } = LENSES[lens];
  return copyFor(lang).map.outOf(formatFixed(value, decimals), max);
}

/** The marker drawn on the map for each kind of service. Its name lives in i18n.ts. */
export const SERVICE_GLYPHS: Record<ServiceType, string> = {
  hospital: 'H', rsa: 'R', pharmacy: 'F', library: 'B', market: 'M',
};

export const SERVICE_ORDER: ServiceType[] = ['hospital', 'rsa', 'pharmacy', 'library', 'market'];
