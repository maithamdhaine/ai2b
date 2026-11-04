import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getHealth } from '../../lib/api';
import type { ChatMessage } from '../../types';
import { renderInline } from '../memo/Markdown';
import { runCommand, type AgentMode, type ChangeChip, type Outcome } from './actions';
import './assistant.css';

type Mode = 'checking' | AgentMode;

const MODE_LABELS: Record<Mode, string> = {
  checking: 'Verifica AI…',
  llm: 'AI attiva',
  rules: 'Modalità regole',
  offline: 'AI non connessa',
};

const EXAMPLES = [
  {
    label: '200.000 € per gli over 75 soli, senza PNRR',
    prompt: 'Ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR',
  },
  {
    label: 'Carenza di servizi in Circoscrizione 6',
    prompt: 'Budget di 150.000 euro, priorità alla carenza di servizi nella Circoscrizione 6',
  },
  {
    label: 'Inclusione e memo per il consiglio',
    prompt: 'Ho 100.000 euro, priorità all\'inclusione, poi prepara il memo per il consiglio',
  },
];

const PLANNER_STILL_WORKS = 'Il planner funziona comunque: budget, pesi e filtri restano disponibili nel pannello a destra.';
const HEALTH_POLL_MS = 30_000;

function Chips({ chips }: { chips: ChangeChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="cmd-chips" aria-label="Modifiche applicate">
      {chips.map(({ text, applied }, index) => (
        <li key={index} className={applied ? 'cmd-chip' : 'cmd-chip cmd-chip--ignored'}>{text}</li>
      ))}
    </ul>
  );
}

export function ReplyArea({ busy, outcome }: { busy: boolean; outcome: Outcome | null }) {
  if (busy) {
    return (
      <div className="cmd-reply cmd-reply--loading">
        <span className="cmd-spinner" aria-hidden="true" />
        Sto interpretando la richiesta…
      </div>
    );
  }
  if (!outcome) return null;
  const asked = <p className="cmd-asked" title={outcome.asked}>Richiesta: {outcome.asked}</p>;

  if (outcome.kind === 'failure') {
    return (
      <div className="cmd-reply cmd-reply--calm">
        {asked}
        <p className="cmd-text">{outcome.message} {PLANNER_STILL_WORKS}</p>
      </div>
    );
  }
  if (outcome.clarification) {
    return (
      <div className="cmd-reply cmd-reply--question">
        {asked}
        <p className="cmd-question">
          <span className="cmd-question__tag">Domanda</span>
          {renderInline(outcome.reply)}
        </p>
        <Chips chips={outcome.chips} />
      </div>
    );
  }
  return (
    <div className="cmd-reply">
      {asked}
      <p className="cmd-text">{renderInline(outcome.reply)}</p>
      <Chips chips={outcome.chips} />
    </div>
  );
}

export default function CommandBar() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('checking');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const historyRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      const health = await getHealth(controller.signal);
      // A running request reports the mode itself, and an old check must not overwrite it.
      if (controller.signal.aborted || busyRef.current) return;
      setMode(health.ok ? health.data.mode : 'offline');
    };
    void check();
    const timer = setInterval(() => { void check(); }, HEALTH_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  const send = async (raw: string) => {
    const asked = raw.trim();
    if (!asked || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setText(asked);

    const result = await runCommand(asked, historyRef.current);
    busyRef.current = false;
    setBusy(false);
    historyRef.current = result.history;
    setMode(result.mode);
    setOutcome(result.outcome);

    // After a failure the text stays in the input, so sending it again takes one key.
    if (result.outcome.kind === 'reply') {
      setText('');
      inputRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  const waitingForAnswer = outcome?.kind === 'reply' && outcome.clarification;

  return (
    <section className="cmd" aria-label="Assistente del planner">
      <form className="cmd-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="cmd-input"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          readOnly={busy}
          placeholder={waitingForAnswer
            ? 'Scrivi qui la risposta'
            : 'Es. ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR'}
          aria-label="Richiesta al planner"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button className="cmd-send" type="submit" disabled={busy || !text.trim()}>Invia</button>
      </form>

      <div className="cmd-meta">
        <span className="cmd-meta__label">Esempi</span>
        {EXAMPLES.map(({ label, prompt }) => (
          <button
            key={label}
            className="cmd-example"
            type="button"
            title={prompt}
            disabled={busy}
            onClick={() => { void send(prompt); }}
          >
            {label}
          </button>
        ))}
        <span className="cmd-mode" data-mode={mode} role="status">
          <span className="cmd-mode__dot" aria-hidden="true" />
          {MODE_LABELS[mode]}
        </span>
      </div>

      <div aria-live="polite">
        <ReplyArea busy={busy} outcome={outcome} />
      </div>
    </section>
  );
}
