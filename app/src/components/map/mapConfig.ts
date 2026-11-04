import type { Lens, ServiceType, Weights, ZoneProps } from '../../types';
import { NOT_AVAILABLE, formatFixed, isNumber } from './format';

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

const NEED_SCALE = 'Punteggio 0-100: più alto, più bisogno.';

export interface LensSpec {
  label: string;
  note: string;
  scale: string;
  max: number;
  decimals: number;
  ramp: string[];
}

export const LENSES: Record<Lens, LensSpec> = {
  isolation: {
    label: 'Isolamento', note: 'Quota stimata di over 75 e persone che vivono sole.',
    scale: NEED_SCALE, max: 100, decimals: 0, ramp: NEED_RAMP,
  },
  service_gap: {
    label: 'Carenza servizi', note: 'Distanza da sanità e cura, pochi servizi entro 800 m.',
    scale: NEED_SCALE, max: 100, decimals: 0, ramp: NEED_RAMP,
  },
  future_pressure: {
    label: 'Pressione futura', note: 'Crescita attesa degli over 75 al 2030, segnale relativo.',
    scale: NEED_SCALE, max: 100, decimals: 0, ramp: NEED_RAMP,
  },
  inclusion: {
    label: 'Inclusione', note: 'Bisogno di accesso ai servizi e di supporto linguistico.',
    scale: NEED_SCALE, max: 100, decimals: 0, ramp: NEED_RAMP,
  },
  funded_share: {
    label: 'Già finanziato', note: 'Euro per residente già assegnati, normalizzati.',
    scale: 'Indice 0-1: più alto, più fondi già presenti.', max: 1, decimals: 2, ramp: FUNDED_RAMP,
  },
};

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

/** Reads as "51 su 100" or "0,46 su 1", so the index is never mistaken for a percentage of funding. */
export function formatLensValue(value: number | null, lens: Lens): string {
  if (value === null) return NOT_AVAILABLE;
  const { max, decimals } = LENSES[lens];
  return `${formatFixed(value, decimals)} su ${max}`;
}

export const SERVICES: Record<ServiceType, { label: string; singular: string; glyph: string }> = {
  hospital: { label: 'Ospedali', singular: 'Ospedale', glyph: 'H' },
  rsa: { label: 'RSA', singular: 'RSA', glyph: 'R' },
  pharmacy: { label: 'Farmacie', singular: 'Farmacia', glyph: 'F' },
  library: { label: 'Biblioteche', singular: 'Biblioteca', glyph: 'B' },
  market: { label: 'Mercati', singular: 'Mercato', glyph: 'M' },
};

export const SERVICE_ORDER: ServiceType[] = ['hospital', 'rsa', 'pharmacy', 'library', 'market'];
