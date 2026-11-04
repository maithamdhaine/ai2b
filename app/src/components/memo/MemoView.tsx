import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { postMemo } from '../../lib/api';
import { plannerState, useStore } from '../../store';
import Markdown from './Markdown';
import { buildMemoTemplate, chooseMemo, type ChosenMemo, type MemoInput } from './template';
import './memo.css';

export type MemoPanel =
  | { status: 'loading' }
  | { status: 'empty'; markdown: string }
  | { status: 'ready'; markdown: string; notice: string };

type CopyState = 'idle' | 'done' | 'failed';

const COPY_LABELS: Record<CopyState, string> = {
  idle: 'Copia',
  done: 'Copiato',
  failed: 'Copia non riuscita',
};

export function readMemoInput(): MemoInput {
  const { zones, meta, funded, interventions } = useStore.getState();
  const state = plannerState();
  const planned = new Set(state.plan.map((item) => item.zone_id));
  return {
    state,
    zones: (zones?.features ?? []).map((feature) => feature.properties).filter((zone) => planned.has(zone.id)),
    meta,
    funded,
    interventions,
  };
}

/** Asks the server for the memo. Never rejects: on any problem the template takes its place. */
export async function loadMemo(input: MemoInput, signal: AbortSignal): Promise<ChosenMemo> {
  const { state, zones, meta } = input;
  const result = await postMemo({ state, plan: state.plan, zones, sources: meta?.sources ?? [] }, signal);
  return chooseMemo(result, buildMemoTemplate(input));
}

/** navigator.clipboard exists only on https and localhost, so the old way stays as a fallback. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

interface MemoDialogProps {
  panel: MemoPanel;
  mock: boolean;
  copyState: CopyState;
  onCopy: () => void;
  onPrint: () => void;
  onClose: () => void;
}

export function MemoDialog({ panel, mock, copyState, onCopy, onPrint, onClose }: MemoDialogProps) {
  const ready = panel.status === 'ready';
  const today = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(new Date());

  return (
    <>
      <div className="memo-toolbar">
        <h2 id="memo-dialog-title">Memo di finanziamento</h2>
        <button type="button" className="memo-button" disabled={!ready} onClick={onCopy}>
          {COPY_LABELS[copyState]}
        </button>
        <button type="button" className="memo-button" disabled={!ready} onClick={onPrint}>Stampa</button>
        <button type="button" className="memo-button memo-button--primary" onClick={onClose}>Chiudi</button>
      </div>

      {ready && <p className="memo-notice">{panel.notice}</p>}

      <div className="memo-scroll">
        {panel.status === 'loading' ? (
          <div className="memo-loading" role="status">
            <span className="memo-spinner" aria-hidden="true" />
            <p>Sto preparando il memo dai dati del piano…</p>
            <p className="memo-loading__hint">Può richiedere fino a 30 secondi.</p>
          </div>
        ) : (
          <article className="memo-paper">
            <p className="memo-letterhead">
              <span>Bussola · Torino</span>
              {mock && <span className="memo-letterhead__mock">DATI DI PROVA</span>}
              <span>{today}</span>
            </p>
            <Markdown source={panel.markdown} />
          </article>
        )}
      </div>
    </>
  );
}

export default function MemoView() {
  const memoRequest = useStore((s) => s.memoRequest);
  const mock = useStore((s) => s.meta?.mock ?? false);
  const [panel, setPanel] = useState<MemoPanel | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const seenRequest = useRef(memoRequest);
  const pending = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = panel !== null;

  const close = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setPanel(null);
  }, []);

  useEffect(() => {
    if (memoRequest <= seenRequest.current) return;
    seenRequest.current = memoRequest;
    pending.current?.abort();
    pending.current = null;
    setCopyState('idle');

    const input = readMemoInput();
    if (input.state.plan.length === 0) {
      setPanel({ status: 'empty', markdown: buildMemoTemplate(input) });
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setPanel({ status: 'loading' });
    void loadMemo(input, controller.signal).then((memo) => {
      if (!controller.signal.aborted) setPanel({ status: 'ready', ...memo });
    });
  }, [memoRequest]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousFocus = document.activeElement;
    const root = document.getElementById('root');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    // Keeps keyboard focus inside the memo, and lets the print styles hide the app.
    root?.setAttribute('inert', '');
    document.documentElement.classList.add('memo-open');
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.classList.remove('memo-open');
      root?.removeAttribute('inert');
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [isOpen, close]);

  useEffect(() => () => {
    pending.current?.abort();
    clearTimeout(copyTimer.current);
  }, []);

  if (!panel) return null;

  const onCopy = () => {
    if (panel.status !== 'ready') return;
    void copyToClipboard(panel.markdown).then((copied) => {
      setCopyState(copied ? 'done' : 'failed');
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState('idle'), 2500);
    });
  };

  // Rendered under <body>, outside #root, so the print styles can hide the whole app.
  return createPortal(
    <div className="memo-overlay">
      <div
        ref={dialogRef}
        className="memo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-dialog-title"
        tabIndex={-1}
      >
        <MemoDialog
          panel={panel}
          mock={mock}
          copyState={copyState}
          onCopy={onCopy}
          onPrint={() => window.print()}
          onClose={close}
        />
      </div>
    </div>,
    document.body,
  );
}
