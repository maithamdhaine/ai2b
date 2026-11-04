import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import type { PlanItem, ZoneCollection, ZoneProps } from '../../types';
import { applyAgentActions, runCommand } from './actions';

const planItem = { zone_id: 70, zone_name: 'Pilonetto' } as PlanItem;

// The ranking has its own tests. Here it only has to return something countable.
vi.mock('../../lib/planner', () => ({ computePlan: () => [planItem, planItem, planItem] }));

const zones: ZoneCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { id: 70, name: 'Pilonetto' } as ZoneProps,
  }],
};

const initial = useStore.getState();

/** Non-breaking spaces from Intl become plain ones, so expectations stay readable. */
const texts = (actions: unknown[]) =>
  applyAgentActions(actions).map(({ text }) => text.replace(/ /g, ' '));

beforeEach(() => useStore.setState({ ...initial, zones, memoRequest: 0 }, true));
afterEach(() => vi.restoreAllMocks());

describe('applyAgentActions', () => {
  it('applies every tool of the contract, in order, and describes it in Italian', () => {
    const chips = texts([
      { tool: 'set_profile', args: { profile: 'third_sector' } },
      { tool: 'set_budget', args: { budget_eur: 200000 } },
      { tool: 'set_weights', args: { isolation: 0.7, service_gap: 0.1, future_pressure: 0.1, inclusion: 0.1 } },
      { tool: 'filter_zones', args: { circ: [6, 2], exclude_funded: true, min_over75: 500 } },
      { tool: 'run_plan', args: {} },
      { tool: 'select_zone', args: { zone_id: 70 } },
      { tool: 'write_memo', args: {} },
    ]);

    expect(chips).toEqual([
      'Profilo: Terzo settore',
      'Budget: 200.000 €',
      'Pesi: isolamento 70%, carenza servizi 10%, pressione futura 10%, inclusione 10%',
      'Circoscrizioni 2, 6',
      'Escluse le zone già finanziate',
      'Almeno 500 over 75 per zona',
      'Piano: 3 interventi',
      'Zona: Pilonetto',
      'Memo in preparazione',
    ]);

    const state = useStore.getState();
    expect(state.profile).toBe('third_sector');
    expect(state.budget_eur).toBe(200000);
    expect(state.weights.isolation).toBe(0.7);
    expect(state.filters).toEqual({ circ: [6, 2], exclude_funded: true, min_over75: 500 });
    expect(state.selected_zone_id).toBe(70);
    expect(state.memoRequest).toBe(1);
  });

  it('describes filters being cleared', () => {
    expect(texts([{ tool: 'filter_zones', args: { circ: [], exclude_funded: false, min_over75: 0 } }]))
      .toEqual(['Tutte le Circoscrizioni', 'Incluse le zone già finanziate', 'Nessun minimo di over 75']);
  });

  it('accepts run_plan and write_memo with no args at all', () => {
    expect(texts([{ tool: 'run_plan' }, { tool: 'write_memo' }])).toEqual(['Piano: 3 interventi', 'Memo in preparazione']);
  });

  it('merges a partial set of weights into the current ones', () => {
    texts([{ tool: 'set_weights', args: { isolation: 0.9 } }]);
    expect(useStore.getState().weights).toEqual({ isolation: 0.9, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 });
  });

  it.each([
    ['a budget that is not a number', { tool: 'set_budget', args: { budget_eur: 'tanti' } }, 'budget'],
    ['a budget of NaN', { tool: 'set_budget', args: { budget_eur: Number.NaN } }, 'budget'],
    ['a negative budget', { tool: 'set_budget', args: { budget_eur: -1 } }, 'budget'],
    ['a budget with no args', { tool: 'set_budget' }, 'budget'],
    ['an unknown profile', { tool: 'set_profile', args: { profile: 'banca' } }, 'profilo'],
    ['an inherited object key as profile', { tool: 'set_profile', args: { profile: 'toString' } }, 'profilo'],
    ['a weight above 1', { tool: 'set_weights', args: { isolation: 40 } }, 'pesi'],
    ['no weights', { tool: 'set_weights', args: {} }, 'pesi'],
    ['circ that is not an array', { tool: 'filter_zones', args: { circ: 6 } }, 'filtri'],
    ['circ with text in it', { tool: 'filter_zones', args: { circ: ['6'] } }, 'filtri'],
    ['a zone that does not exist', { tool: 'select_zone', args: { zone_id: 9999 } }, 'selezione della zona'],
  ])('refuses %s and leaves the state as it was', (_name, action, label) => {
    const before = useStore.getState();
    const [chip] = applyAgentActions([action]);

    expect(chip).toEqual({ text: `Azione ignorata: ${label}`, applied: false });
    const after = useStore.getState();
    expect(after.budget_eur).toBe(before.budget_eur);
    expect(after.profile).toBe(before.profile);
    expect(after.weights).toEqual(before.weights);
    expect(after.filters).toEqual(before.filters);
    expect(after.selected_zone_id).toBe(before.selected_zone_id);
  });

  it('survives values that are not actions at all', () => {
    const chips = applyAgentActions([null, 12, 'run_plan', [], {}, { tool: 'rm_rf' }, { tool: 42 }]);
    expect(chips).toHaveLength(7);
    expect(chips.every(({ applied }) => !applied)).toBe(true);
    expect(chips[5].text).toBe('Azione ignorata: non riconosciuta');
  });

  it('does not mistake an inherited object key for a tool name', () => {
    expect(applyAgentActions([{ tool: 'toString' }, { tool: '__proto__' }, { tool: 'constructor' }]).map(({ text }) => text))
      .toEqual(Array(3).fill('Azione ignorata: non riconosciuta'));
  });

  it('ignores fields outside the contract', () => {
    texts([{ tool: 'filter_zones', args: { min_over75: 100, circ: null, hacked: true } }]);
    expect(useStore.getState().filters).toEqual({ circ: [], exclude_funded: false, min_over75: 100 });
  });

  it('keeps going after a bad action', () => {
    const chips = texts([
      { tool: 'set_budget', args: { budget_eur: Number.POSITIVE_INFINITY } },
      { tool: 'set_budget', args: { budget_eur: 50000 } },
    ]);
    expect(chips).toEqual(['Azione ignorata: budget', 'Budget: 50.000 €']);
    expect(useStore.getState().budget_eur).toBe(50000);
  });

  it('catches an error from the store and goes on with the next action', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realApply = initial.applyAction;
    useStore.setState({
      applyAction: (action) => {
        if (action.tool === 'run_plan') throw new Error('rotto');
        realApply(action);
      },
    });

    const chips = applyAgentActions([{ tool: 'run_plan', args: {} }, { tool: 'set_budget', args: { budget_eur: 70000 } }]);

    expect(chips[0]).toEqual({ text: 'Azione ignorata: ricalcolo del piano', applied: false });
    expect(chips[1].applied).toBe(true);
    expect(useStore.getState().budget_eur).toBe(70000);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe('runCommand', () => {
  const answer = (body: unknown) => new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
  const serverReplies = (...bodies: unknown[]) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer(bodies.shift()));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const sentBody = (fetchMock: ReturnType<typeof serverReplies>, call = 0) =>
    JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

  afterEach(() => vi.unstubAllGlobals());

  it('sends the question with the planner state, applies the actions and keeps the exchange', async () => {
    const fetchMock = serverReplies({
      reply: 'Budget aggiornato.', actions: [{ tool: 'set_budget', args: { budget_eur: 200000 } }],
      needs_clarification: false, mode: 'llm',
    });

    const result = await runCommand('ho 200.000 euro', []);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/agent');
    expect(sentBody(fetchMock)).toEqual({
      messages: [{ role: 'user', content: 'ho 200.000 euro' }],
      state: {
        profile: 'foundation', budget_eur: 100000, selected_zone_id: null,
        weights: initial.weights, filters: initial.filters, plan: [],
      },
    });
    expect(useStore.getState().budget_eur).toBe(200000);
    expect(result.mode).toBe('llm');
    expect(result.history).toEqual([
      { role: 'user', content: 'ho 200.000 euro' },
      { role: 'assistant', content: 'Budget aggiornato.' },
    ]);
    expect(result.outcome).toMatchObject({ kind: 'reply', reply: 'Budget aggiornato.', clarification: false });
  });

  it('carries a clarification into the next request', async () => {
    const fetchMock = serverReplies(
      { reply: 'Qual è il budget?', actions: [], needs_clarification: true, mode: 'rules' },
      { reply: 'Fatto.', actions: [], needs_clarification: false, mode: 'rules' },
    );

    const first = await runCommand('priorità agli over 75', []);
    expect(first.outcome).toMatchObject({ clarification: true, reply: 'Qual è il budget?' });
    expect(first.mode).toBe('rules');

    await runCommand('200k', first.history);
    expect(sentBody(fetchMock, 1).messages).toEqual([
      { role: 'user', content: 'priorità agli over 75' },
      { role: 'assistant', content: 'Qual è il budget?' },
      { role: 'user', content: '200k' },
    ]);
  });

  it('leaves the planner and the history alone when the server is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const history = [{ role: 'user' as const, content: 'a' }, { role: 'assistant' as const, content: 'b' }];
    const before = useStore.getState();

    const result = await runCommand('ciao', history);

    expect(result.mode).toBe('offline');
    expect(result.history).toBe(history);
    expect(result.outcome).toEqual({ kind: 'failure', asked: 'ciao', message: 'Il server AI non è raggiungibile.' });
    expect(useStore.getState()).toBe(before);
  });

  it('sends a bounded history that still starts with the user', async () => {
    const fetchMock = serverReplies({ reply: 'ok', actions: [], mode: 'llm' });
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const, content: String(i),
    }));

    await runCommand('ultima', history);

    const { messages } = sentBody(fetchMock);
    expect(messages).toHaveLength(13);
    expect(messages[0].role).toBe('user');
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'ultima' });
  });

  it('never claims a change that did not happen, and never stores an empty reply', async () => {
    serverReplies(
      { reply: '', actions: [{ tool: 'set_budget', args: { budget_eur: 50000 } }], mode: 'llm' },
      { reply: '', actions: [{ tool: 'set_budget', args: { budget_eur: 'molti' } }], mode: 'llm' },
    );

    const applied = await runCommand('uno', []);
    expect(applied.outcome).toMatchObject({ reply: 'Ho aggiornato il piano.' });

    const refused = await runCommand('due', []);
    expect(refused.outcome).toMatchObject({ reply: 'Non ho capito la richiesta: puoi riformularla?' });
    expect(refused.history[1].content).toBe('Non ho capito la richiesta: puoi riformularla?');
  });
});
