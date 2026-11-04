import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FundedProject, ZoneProps } from '../../types';
import ZonePanel from './ZonePanel';
import { formatEuro, formatInteger, formatMeters, formatPercentage, formatShare } from './format';
import {
  HATCH_FILL, LENSES, MISSING_FILL, classIndex, formatLensValue, lensClasses, lensValue, zoneFill,
} from './mapConfig';

const zone: ZoneProps = {
  id: 70, name: 'Pilonetto', circ: 8, pop_2025: 12345, over65_est: 2345, over75_est: 1234,
  adults_50_64_est: 2000, over75_2030: null, alone_rate_circ: 0.385, foreign_share: 0.1,
  isolation: 51, service_gap: 20, future_pressure: 80, inclusion: 0,
  funded_eur: 1886674, funded_projects: 1, funded_share: 0.456,
  nearest: { health_m: 1250, care_m: 300, pharmacy_m: null },
  services_800m: 5, stability_top10: null, confidence: 'estimated', small_zone: false,
};

const project: FundedProject = {
  id: 1, title: 'Casa di comunità', programme: 'PNRR', amount_eur: 1886674, progress_pct: null,
  circ: 8, zone_id: 70, theme: 'Sociale', source: 'Comune di Torino',
};

const panel = (props: Partial<ZoneProps> = {}, projects: FundedProject[] = []) => renderToStaticMarkup(
  <ZonePanel
    zone={{ ...zone, ...props }}
    projects={projects}
    sources={[{ key: 'pop', label: 'Anagrafe', url: '', year: 2025, level: 'zona' }]}
    inPlan={false}
    onClose={() => {}}
  />,
);

describe('classes', () => {
  it('puts score boundaries in the upper class and clamps out-of-range values', () => {
    const cases: [number, number][] = [
      [-1, 0], [0, 0], [19.99, 0], [20, 1], [40, 2], [60, 3], [79.99, 3], [80, 4], [100, 4], [101, 4],
    ];
    for (const [value, expected] of cases) expect(classIndex(value, 'isolation')).toBe(expected);
  });

  it('classifies funded_share on 0-1, including floating-point boundaries', () => {
    const cases: [number, number][] = [[0, 0], [0.2, 1], [0.4, 2], [0.6, 3], [0.8, 4], [1, 4]];
    for (const [value, expected] of cases) expect(classIndex(value, 'funded_share')).toBe(expected);
  });

  it('labels the five ranges of each scale', () => {
    expect(lensClasses('isolation').map((c) => c.label)).toEqual(['0–20', '20–40', '40–60', '60–80', '80–100']);
    expect(lensClasses('funded_share').map((c) => c.label))
      .toEqual(['0,00–0,20', '0,20–0,40', '0,40–0,60', '0,60–0,80', '0,80–1,00']);
  });

  it('gives every lens five colours', () => {
    for (const spec of Object.values(LENSES)) expect(spec.ramp).toHaveLength(5);
  });
});

describe('zone fill', () => {
  it('hatches small zones whatever their value', () => {
    expect(zoneFill({ ...zone, small_zone: true }, 'isolation').fillColor).toBe(HATCH_FILL);
  });

  it('uses the ramp for a value and a neutral fill for an empty score', () => {
    expect(zoneFill(zone, 'isolation').fillColor).toBe(LENSES.isolation.ramp[2]);
    expect(zoneFill(zone, 'funded_share').fillColor).toBe(LENSES.funded_share.ramp[2]);
    const empty = { ...zone, isolation: null } as unknown as ZoneProps;
    expect(lensValue(empty, 'isolation')).toBeNull();
    expect(zoneFill(empty, 'isolation').fillColor).toBe(MISSING_FILL);
  });
});

describe('Italian formats', () => {
  it('groups four-digit numbers and uses the decimal comma', () => {
    expect(formatInteger(1234)).toBe('1.234');
    expect(formatEuro(1234)).toBe('1.234 €');
    expect(formatMeters(1250)).toBe('1.250 m');
    expect(formatShare(0.385)).toBe('38,5%');
    expect(formatPercentage(70)).toBe('70%');
  });

  it('shows n.d. for null, undefined and NaN', () => {
    for (const format of [formatInteger, formatEuro, formatMeters, formatShare, formatPercentage]) {
      expect(format(null)).toBe('n.d.');
      expect(format(undefined)).toBe('n.d.');
      expect(format(Number.NaN)).toBe('n.d.');
    }
  });

  it('states the scale of a lens value', () => {
    expect(formatLensValue(51, 'isolation')).toBe('51 su 100');
    expect(formatLensValue(0.456, 'funded_share')).toBe('0,46 su 1');
    expect(formatLensValue(null, 'isolation')).toBe('n.d.');
  });
});

describe('ZonePanel', () => {
  it('shows the zone figures in Italian format', () => {
    const html = panel();
    expect(html).toContain('Pilonetto');
    expect(html).toContain('Circoscrizione 8');
    expect(html).toContain('12.345');
    expect(html).toContain('2.345');
    expect(html).toContain('1.234');
    expect(html).toContain('38,5%');
    expect(html).toContain('dato di Circoscrizione');
    expect(html).toContain('1.250 m');
    expect(html).toContain('1.886.674');
  });

  it('labels age figures as estimates unless the zone is official', () => {
    const tags = (html: string) => html.match(/>stima</g)?.length ?? 0;
    expect(tags(panel({ confidence: 'estimated' }))).toBe(2);
    expect(tags(panel({ confidence: 'low' }))).toBe(2);
    expect(tags(panel({ confidence: 'official' }))).toBe(0);
  });

  it('names each confidence level', () => {
    expect(panel({ confidence: 'official' })).toContain('Dato ufficiale');
    expect(panel({ confidence: 'estimated' })).toContain('>Stima<');
    expect(panel({ confidence: 'low' })).toContain('Bassa affidabilità');
  });

  it('survives every nullable field', () => {
    const html = panel({ nearest: { health_m: null, care_m: null, pharmacy_m: null } });
    expect(html.match(/n\.d\./g)).toHaveLength(3);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('null');
  });

  it('shows stability only when present', () => {
    expect(panel()).not.toContain('prime 10');
    expect(panel({ stability_top10: 0 })).toContain('prime 10');
    expect(panel({ stability_top10: 0.64 })).toContain('64%');
  });

  it('lists matching projects, with n.d. for missing progress, or says there are none', () => {
    const html = panel({}, [project]);
    expect(html).toContain('Casa di comunità');
    expect(html).toContain('Avanzamento n.d.');
    expect(html).not.toContain('Nessun progetto');
    expect(panel()).toContain('Nessun progetto');
  });

  it('flags small zones and shows source years', () => {
    expect(panel()).not.toContain('esclusa dalla classifica');
    expect(panel({ small_zone: true })).toContain('esclusa dalla classifica');
    expect(panel()).toContain('Anagrafe, 2025 (zona)');
  });
});
