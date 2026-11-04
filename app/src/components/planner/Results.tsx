import { useEffect, useMemo, useRef } from 'react';
import { interventionLabel } from '../../i18n';
import { useCopy, useStore } from '../../store';
import type { Confidence, PlanItem } from '../../types';
import {
  confidenceLabels, formatEur, formatInt, formatReturnIndex, hasActiveFilters,
  reasonFor, summarisePlan,
} from './format';

export function PlanSummary() {
  const t = useCopy().planner;
  const plan = useStore((s) => s.plan);
  const summary = useMemo(() => summarisePlan(plan), [plan]);
  return (
    <dl className="pl-summary" aria-label={t.summaryAria}>
      <div>
        <dt>{t.summary.used}</dt>
        <dd>{formatEur(summary.used_eur)}</dd>
      </div>
      <div>
        <dt>{t.summary.people}</dt>
        <dd>{formatInt(summary.people)}</dd>
      </div>
      <div>
        <dt>{t.summary.perPerson}</dt>
        <dd>{formatEur(summary.avg_cost_eur)}</dd>
      </div>
      <div>
        <dt>{t.summary.zones}</dt>
        <dd>{formatInt(summary.zones)}</dd>
      </div>
    </dl>
  );
}

function ConfidenceBadge({ level }: { level: Confidence }) {
  const t = useCopy();
  return <span className={`pl-badge pl-badge--${level}`}>{confidenceLabels(t.lang)[level]}</span>;
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
  const t = useCopy();
  const circLabel = t.zone.circ(String(item.circ));
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
            {circLabel} · {interventionLabel(item.intervention_id, item.intervention_label, t.lang)}
          </span>
          <span className="pl-item__why">
            <span>{reason}</span>
            <ConfidenceBadge level={item.confidence} />
          </span>
          <span className="pl-item__metrics">
            <Metric value={formatInt(item.people_reached)} label={t.planner.metrics.people} />
            <Metric value={formatEur(item.cost_per_person_eur)} label={t.planner.metrics.perPerson} />
            <Metric value={formatReturnIndex(item.return_index)} label={t.planner.metrics.index} />
          </span>
        </span>
      </button>
    </li>
  );
}

function EmptyPlan() {
  const t = useCopy().planner;
  const zones = useStore((s) => s.zones);
  const loadError = useStore((s) => s.loadError);
  const interventions = useStore((s) => s.interventions);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);

  if (loadError) return <p className="pl-empty">{t.emptyError}</p>;
  if (!zones) return <p className="pl-empty">{t.emptyLoading}</p>;

  const filtered = hasActiveFilters(filters);
  let hint = t.emptyBudget;
  if (interventions.length === 0) hint = t.emptyNoInterventions;
  else if (filtered) hint = t.emptyFiltered;

  return (
    <div className="pl-empty">
      <p className="pl-empty__title">{t.emptyTitle}</p>
      <p>{hint}</p>
      {filtered && (
        <button
          type="button"
          className="pl-link"
          onClick={() => setFilters({ circ: [], exclude_funded: false, min_over75: 0 })}
        >
          {t.clearFilters}
        </button>
      )}
    </div>
  );
}

export function PlanResults() {
  const copy = useCopy();
  const t = copy.planner;
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
        <h2 id="pl-results-title">{t.resultsTitle}</h2>
        {plan.length > 0 && <span>{t.interventionCount(plan.length)}</span>}
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
                  copy.lang,
                )}
                selected={item.zone_id === selectedZone}
                onSelect={() => selectZone(item.zone_id)}
              />
            ))}
          </ol>
          <p className="pl-footnote">
            {t.footnote}
            {overlapping_zones && t.overlapNote}
          </p>
        </>
      )}
    </section>
  );
}
