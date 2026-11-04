import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store';
import type { Confidence, PlanItem } from '../../types';
import {
  CONFIDENCE_LABEL, formatEur, formatInt, formatReturnIndex, hasActiveFilters,
  reasonFor, summarisePlan,
} from './format';

export function PlanSummary() {
  const plan = useStore((s) => s.plan);
  const summary = useMemo(() => summarisePlan(plan), [plan]);
  return (
    <dl className="pl-summary" aria-label="Sintesi del piano">
      <div>
        <dt>impiegati</dt>
        <dd>{formatEur(summary.used_eur)}</dd>
      </div>
      <div>
        <dt>persone (stima)</dt>
        <dd>{formatInt(summary.people)}</dd>
      </div>
      <div>
        <dt>media a persona</dt>
        <dd>{formatEur(summary.avg_cost_eur)}</dd>
      </div>
      <div>
        <dt>zone</dt>
        <dd>{formatInt(summary.zones)}</dd>
      </div>
    </dl>
  );
}

function ConfidenceBadge({ level }: { level: Confidence }) {
  return <span className={`pl-badge pl-badge--${level}`}>{CONFIDENCE_LABEL[level]}</span>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="pl-metric">
      <span className="pl-metric__value">{value}</span>
      <span className="pl-metric__label">{label}</span>
    </span>
  );
}

interface ResultItemProps {
  item: PlanItem;
  rank: number;
  reason: string | null;
  selected: boolean;
  onSelect: () => void;
}

function ResultItem({ item, rank, reason, selected, onSelect }: ResultItemProps) {
  return (
    <li>
      <button type="button" className="pl-item" aria-pressed={selected} onClick={onSelect}>
        <span className="pl-item__rank">{rank}</span>
        <span className="pl-item__body">
          <span className="pl-item__head">
            <span className="pl-item__zone">{item.zone_name}</span>
            <span className="pl-item__amount">{formatEur(item.budget_eur)}</span>
          </span>
          <span className="pl-item__what">
            Circoscrizione {item.circ} · {item.intervention_label}
          </span>
          <span className="pl-item__why">
            <span>{reason}</span>
            <ConfidenceBadge level={item.confidence} />
          </span>
          <span className="pl-item__metrics">
            <Metric value={formatInt(item.people_reached)} label="persone" />
            <Metric value={formatEur(item.cost_per_person_eur)} label="a persona" />
            <Metric value={formatReturnIndex(item.return_index)} label="indice di ritorno atteso" />
          </span>
        </span>
      </button>
    </li>
  );
}

function EmptyPlan() {
  const zones = useStore((s) => s.zones);
  const loadError = useStore((s) => s.loadError);
  const interventions = useStore((s) => s.interventions);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);

  if (loadError) return <p className="pl-empty">Dati non disponibili: il piano non si può calcolare.</p>;
  if (!zones) return <p className="pl-empty">Caricamento dei dati delle zone…</p>;

  const filtered = hasActiveFilters(filters);
  let hint = 'Con questo budget nessun intervento è finanziabile. Prova ad aumentarlo.';
  if (interventions.length === 0) hint = 'Non ci sono interventi da valutare.';
  else if (filtered) hint = 'Nessuna zona rispetta i filtri con questo budget. Allenta i filtri o aumenta il budget.';

  return (
    <div className="pl-empty">
      <p className="pl-empty__title">Nessun intervento nel piano</p>
      <p>{hint}</p>
      {filtered && (
        <button
          type="button"
          className="pl-link"
          onClick={() => setFilters({ circ: [], exclude_funded: false, min_over75: 0 })}
        >
          Azzera i filtri
        </button>
      )}
    </div>
  );
}

export function PlanResults() {
  const plan = useStore((s) => s.plan);
  const weights = useStore((s) => s.weights);
  const interventions = useStore((s) => s.interventions);
  const selectedZone = useStore((s) => s.selected_zone_id);
  const selectZone = useStore((s) => s.selectZone);
  const listRef = useRef<HTMLOListElement>(null);
  const { overlapping_zones } = useMemo(() => summarisePlan(plan), [plan]);

  // A zone picked on the map may be further down the list: bring it into view.
  useEffect(() => {
    if (selectedZone === null) return;
    listRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedZone]);

  return (
    <section className="pl-results" aria-labelledby="pl-results-title">
      <header className="pl-results__head">
        <h2 id="pl-results-title">Portafoglio proposto</h2>
        {plan.length > 0 && (
          <span>{plan.length === 1 ? '1 intervento' : `${plan.length} interventi`}</span>
        )}
      </header>
      {plan.length === 0 ? <EmptyPlan /> : (
        <>
          <ol className="pl-list" ref={listRef}>
            {plan.map((item, index) => (
              <ResultItem
                key={`${item.zone_id}-${item.intervention_id}`}
                item={item}
                rank={index + 1}
                reason={reasonFor(
                  item.scores,
                  weights,
                  interventions.find(({ id }) => id === item.intervention_id)?.fit,
                )}
                selected={item.zone_id === selectedZone}
                onSelect={() => selectZone(item.zone_id)}
              />
            ))}
          </ol>
          <p className="pl-footnote">
            L'indice di ritorno atteso conta le persone raggiunte, pesate per beneficio
            dell'intervento, bisogno della zona e addizionalità, ogni 1.000 € di costo. È una stima
            per confrontare le opzioni, non un ritorno misurato.
            {overlapping_zones && ' Nelle zone con più interventi la stessa persona può essere contata più volte.'}
          </p>
        </>
      )}
    </section>
  );
}
