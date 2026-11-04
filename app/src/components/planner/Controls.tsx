import type { CSSProperties } from 'react';
import { useStore } from '../../store';
import type { Profile } from '../../types';
import Group from './Group';
import NumberField from './NumberField';
import {
  BUDGET_MAX, BUDGET_MID, BUDGET_MIN, BUDGET_POSITIONS, CRITERIA,
  allWeightsZero, budgetToPosition, filtersRecap, formatEur, formatInt,
  positionToBudget, weightShares,
} from './format';

const PROFILES: { id: Profile; label: string }[] = [
  { id: 'foundation', label: 'Fondazione' },
  { id: 'third_sector', label: 'Terzo settore' },
  { id: 'institution', label: 'Istituzione' },
];

const CIRCOSCRIZIONI = [1, 2, 3, 4, 5, 6, 7, 8];

/** The share of the track to colour; WebKit has no native "progress" part to style. */
const trackFill = (percent: number) => ({ '--pl-fill': `${percent}%` }) as CSSProperties;

export function ProfileControl() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  return (
    <div
      className="pl-row"
      role="radiogroup"
      aria-labelledby="pl-profile-label"
      title="Il profilo va all'assistente e al memo; non cambia la classifica."
    >
      <span className="pl-label" id="pl-profile-label">Profilo</span>
      <div className="pl-segments">
        {PROFILES.map(({ id, label }) => (
          <label key={id} className="pl-segment">
            <input
              type="radio"
              name="pl-profile"
              value={id}
              checked={profile === id}
              onChange={() => setProfile(id)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function BudgetControl() {
  const budget = useStore((s) => s.budget_eur);
  const setBudget = useStore((s) => s.setBudget);
  const position = budgetToPosition(budget);
  return (
    <div className="pl-field">
      <div className="pl-row pl-row--budget">
        <label className="pl-label" htmlFor="pl-budget">Budget</label>
        <div className="pl-money pl-money--large">
          <NumberField id="pl-budget" value={budget} onCommit={setBudget} />
          <span aria-hidden="true">€</span>
        </div>
      </div>
      <input
        className="pl-range"
        type="range"
        aria-label="Budget, cursore"
        aria-valuetext={formatEur(budget)}
        min={0}
        max={BUDGET_POSITIONS}
        step={1}
        value={position}
        style={trackFill((position / BUDGET_POSITIONS) * 100)}
        onChange={(event) => setBudget(positionToBudget(Number(event.target.value)))}
      />
      <div className="pl-ticks" aria-hidden="true">
        <span>{formatInt(BUDGET_MIN)}</span>
        <span>{formatInt(BUDGET_MID)}</span>
        <span>{formatInt(BUDGET_MAX)}</span>
      </div>
    </div>
  );
}

export function WeightsControl() {
  const weights = useStore((s) => s.weights);
  const setWeights = useStore((s) => s.setWeights);
  const shares = weightShares(weights);
  const noWeights = allWeightsZero(weights);
  return (
    <div className="pl-field" role="group" aria-labelledby="pl-weights-label">
      <div className="pl-heading">
        <span className="pl-label" id="pl-weights-label">Priorità</span>
        <span className={noWeights ? 'pl-note pl-note--warn' : 'pl-note'}>
          {noWeights ? 'Pesi a zero: criteri alla pari' : 'Percentuale sul totale'}
        </span>
      </div>
      <div className="pl-weights">
        {CRITERIA.map(({ key, label }) => {
          const id = `pl-weight-${key}`;
          return (
            <div className="pl-weight" key={key}>
              <label htmlFor={id}>{label}</label>
              <output className="pl-weight__share" htmlFor={id}>{shares[key]}%</output>
              <input
                id={id}
                className="pl-range"
                type="range"
                aria-valuetext={`${shares[key]}% del totale`}
                min={0}
                max={1}
                step={0.01}
                value={weights[key]}
                style={trackFill(weights[key] * 100)}
                onChange={(event) => setWeights({ [key]: Number(event.target.value) })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FiltersControl() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);

  const toggleCirc = (circ: number) => setFilters({
    circ: filters.circ.includes(circ)
      ? filters.circ.filter((c) => c !== circ)
      : [...filters.circ, circ].sort((a, b) => a - b),
  });

  return (
    <Group title="Filtri" recap={filtersRecap(filters)}>
      <span className="pl-label" id="pl-circ-label">Circoscrizione</span>
      <div className="pl-chips" role="group" aria-labelledby="pl-circ-label">
        <button
          type="button"
          className="pl-chip pl-chip--all"
          aria-pressed={filters.circ.length === 0}
          onClick={() => setFilters({ circ: [] })}
        >
          Tutte
        </button>
        {CIRCOSCRIZIONI.map((circ) => (
          <button
            key={circ}
            type="button"
            className="pl-chip"
            aria-label={`Circoscrizione ${circ}`}
            aria-pressed={filters.circ.includes(circ)}
            onClick={() => toggleCirc(circ)}
          >
            {circ}
          </button>
        ))}
      </div>
      <label className="pl-check">
        <input
          type="checkbox"
          checked={filters.exclude_funded}
          onChange={(event) => setFilters({ exclude_funded: event.target.checked })}
        />
        <span>Escludi zone già finanziate</span>
      </label>
      <div className="pl-row pl-row--spread">
        <label htmlFor="pl-min-over75">Minimo over 75 per zona</label>
        <div className="pl-money">
          <NumberField
            id="pl-min-over75"
            value={filters.min_over75}
            onCommit={(min_over75) => setFilters({ min_over75 })}
            emptyIsZero
          />
        </div>
      </div>
    </Group>
  );
}
