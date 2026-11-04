import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { copyFor } from '../../i18n';
import { setFormatLang } from '../../lib/intl';
import { useStore } from '../../store';
import type { Outcome } from './actions';
import CommandBar, { ReplyArea } from './CommandBar';

// ReplyArea takes its words as a prop, so those cases are checked in Italian. The
// whole component reads the store, so it is checked in the language it ships in.
beforeAll(() => setFormatLang('it'));
afterEach(() => useStore.setState({ lang: 'en' }));

const reply = (over: Partial<Extract<Outcome, { kind: 'reply' }>> = {}): Outcome => ({
  kind: 'reply', asked: 'ho 200.000 euro', reply: 'Fatto.', clarification: false, chips: [], ...over,
});

const area = (outcome: Outcome | null, busy = false) =>
  renderToStaticMarkup(<ReplyArea busy={busy} outcome={outcome} t={copyFor('it').cmd} />);

describe('CommandBar', () => {
  it('starts with the input, three examples and the mode indicator', () => {
    const html = renderToStaticMarkup(<CommandBar />);
    expect(html).toContain('placeholder="E.g. I have 200,000 euro, priority to over-75s living alone, avoid zones already covered by the PNRR"');
    expect(html.match(/class="cmd-example"/g)).toHaveLength(3);
    expect(html).toContain('Checking AI…');
  });

  it('is in Italian once the language is switched', () => {
    useStore.setState({ lang: 'it' });
    const html = renderToStaticMarkup(<CommandBar />);
    expect(html).toContain('placeholder="Es. ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR"');
    expect(html).toContain('Verifica AI…');
  });
});

describe('ReplyArea', () => {
  it('shows nothing before the first request', () => {
    expect(area(null)).toBe('');
  });

  it('shows the loading state, in place of the last reply', () => {
    const html = area(reply(), true);
    expect(html).toContain('Sto interpretando la richiesta…');
    expect(html).not.toContain('Fatto.');
  });

  it('shows the reply, the request and the chips', () => {
    const html = area(reply({
      chips: [{ text: 'Budget: 200.000 €', applied: true }, { text: 'Azione ignorata: filtri', applied: false }],
    }));
    expect(html).toContain('Richiesta: ho 200.000 euro');
    expect(html).toContain('Fatto.');
    expect(html).toContain('<li class="cmd-chip">Budget: 200.000 €</li>');
    expect(html).toContain('<li class="cmd-chip cmd-chip--ignored">Azione ignorata: filtri</li>');
  });

  it('marks a clarification as a question', () => {
    const html = area(reply({ reply: 'Qual è il budget?', clarification: true }));
    expect(html).toContain('cmd-reply--question');
    expect(html).toContain('Domanda');
    expect(html).toContain('Qual è il budget?');
  });

  it('says calmly that the server is off, and that the planner still works', () => {
    const html = area({ kind: 'failure', asked: 'ciao', message: 'Il server AI non è raggiungibile.' });
    expect(html).toContain('cmd-reply--calm');
    expect(html).toContain('Il server AI non è raggiungibile.');
    expect(html).toContain('Il planner funziona comunque');
  });

  it('never renders HTML from a reply', () => {
    const html = area(reply({ reply: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
