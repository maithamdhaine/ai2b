import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import type { PlanItem, ZoneCollection, ZoneProps } from '../../types';
import MemoView, { MemoDialog, loadMemo, readMemoInput, type MemoPanel } from './MemoView';
import type { MemoInput } from './template';

const dialog = (panel: MemoPanel, mock = false) => renderToStaticMarkup(
  <MemoDialog panel={panel} mock={mock} copyState="idle" onCopy={vi.fn()} onPrint={vi.fn()} onClose={vi.fn()} />,
);

const isDisabled = (html: string, label: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);

describe('MemoView', () => {
  it('stays closed until a memo is requested', () => {
    expect(renderToStaticMarkup(<MemoView />)).toBe('');
  });
});

describe('readMemoInput', () => {
  const feature = (id: number): ZoneCollection['features'][number] => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { id, name: `Zona ${id}`, pop_2025: id * 100 } as ZoneProps,
  });

  it('takes the full facts of the zones in the plan, once each, and leaves the others out', () => {
    useStore.setState({
      zones: { type: 'FeatureCollection', features: [feature(1), feature(2), feature(3)] },
      plan: [{ zone_id: 3 }, { zone_id: 1 }, { zone_id: 3 }] as PlanItem[],
    });

    const { zones, state } = readMemoInput();

    expect(zones.map(({ id }) => id).sort()).toEqual([1, 3]);
    expect(zones.find(({ id }) => id === 3)).toEqual(feature(3).properties);
    expect(state.plan).toHaveLength(3);
  });
});

describe('loadMemo', () => {
  const source = { key: 'pop', label: 'Popolazione', url: '', year: 2025, level: 'zona' };

  const input = (): MemoInput => ({
    state: {
      profile: 'foundation',
      budget_eur: 100000,
      weights: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
      filters: { circ: [], exclude_funded: false, min_over75: 0 },
      selected_zone_id: null,
      plan: [{
        zone_id: 70, zone_name: 'Pilonetto', circ: 8, intervention_id: 'v', intervention_label: 'Visite',
        budget_eur: 24700, people_reached: 42, cost_per_person_eur: 588, return_index: 0.0085,
        scores: { isolation: 72, service_gap: 53, future_pressure: 26, inclusion: 11, funded_share: 0 },
        confidence: 'estimated',
      }],
    },
    zones: [{ id: 70, name: 'Pilonetto' } as ZoneProps],
    meta: { mock: false, generated_at: '', sources: [source] },
    funded: [],
    interventions: [],
  });

  afterEach(() => vi.unstubAllGlobals());

  it('posts state, plan, zones and sources, and shows the text of the server', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ markdown: '# Dal server', mode: 'llm' }),
      { headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const memoInput = input();

    const memo = await loadMemo(memoInput, new AbortController().signal);

    expect(memo.markdown).toBe('# Dal server');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/memo');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      state: memoInput.state, plan: memoInput.state.plan, zones: memoInput.zones, sources: [source],
    });
  });

  it('writes the template memo when the server is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const memo = await loadMemo(input(), new AbortController().signal);

    expect(memo.markdown).toContain('## Sintesi');
    expect(memo.markdown).toContain('Pilonetto');
    expect(memo.notice).toBe('Il server AI non è raggiungibile. Memo generato in locale dai dati del piano.');
  });
});

describe('MemoDialog', () => {
  it('shows a loading state, with only Chiudi available', () => {
    const html = dialog({ status: 'loading' });
    expect(html).toContain('Sto preparando il memo');
    expect(isDisabled(html, 'Copia')).toBe(true);
    expect(isDisabled(html, 'Stampa')).toBe(true);
    expect(isDisabled(html, 'Chiudi')).toBe(false);
  });

  it('shows the memo, says where it comes from and enables every button', () => {
    const html = dialog({ status: 'ready', markdown: '# Titolo\n\n**Testo**', notice: 'Memo generato in locale.' });
    expect(html).toContain('<h1>Titolo</h1>');
    expect(html).toContain('<strong>Testo</strong>');
    expect(html).toContain('Memo generato in locale.');
    expect(isDisabled(html, 'Copia')).toBe(false);
    expect(isDisabled(html, 'Stampa')).toBe(false);
  });

  it('shows the guidance for an empty plan, with nothing to copy or print', () => {
    const html = dialog({ status: 'empty', markdown: '# Memo non ancora disponibile' });
    expect(html).toContain('Memo non ancora disponibile');
    expect(isDisabled(html, 'Copia')).toBe(true);
    expect(isDisabled(html, 'Stampa')).toBe(true);
  });

  it('marks mock data on the page that gets printed', () => {
    const html = dialog({ status: 'ready', markdown: 'Testo', notice: '' }, true);
    expect(html).toContain('DATI DI PROVA');
    expect(html.indexOf('DATI DI PROVA')).toBeGreaterThan(html.indexOf('memo-paper'));
  });
});
