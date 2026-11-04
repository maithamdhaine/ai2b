import { interventions as initialInterventions } from '../../data/interventions';
import { interventionLabel } from '../../i18n';
import { useCopy, useStore } from '../../store';
import type { Intervention } from '../../types';
import Group from './Group';
import NumberField from './NumberField';
import { targetLabels } from './format';

const EDITABLE = ['reach_share', 'fixed_eur', 'eur_per_person'] as const;

function isEdited(intervention: Intervention) {
  const initial = initialInterventions.find(({ id }) => id === intervention.id);
  return !!initial && EDITABLE.some((field) => initial[field] !== intervention[field]);
}

function AssumptionRow({ intervention }: { intervention: Intervention }) {
  const copy = useCopy();
  const t = copy.planner;
  const setIntervention = useStore((s) => s.setIntervention);
  const { id, label, target, reach_share, fixed_eur, eur_per_person } = intervention;
  return (
    <fieldset className="pl-assumption">
      <legend>{interventionLabel(id, label, copy.lang)}</legend>
      <div className="pl-assumption__fields">
        <label>
          <span>{t.reachLabel(targetLabels(copy.lang)[target])}</span>
          <span className="pl-money">
            <NumberField
              value={Math.round(reach_share * 100)}
              max={100}
              emptyIsZero
              onCommit={(percent) => setIntervention(id, { reach_share: percent / 100 })}
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
        <label>
          <span>{t.fixedCost}</span>
          <span className="pl-money">
            <NumberField
              value={fixed_eur}
              emptyIsZero
              onCommit={(value) => setIntervention(id, { fixed_eur: value })}
            />
            <span aria-hidden="true">€</span>
          </span>
        </label>
        <label>
          <span>{t.costPerPerson}</span>
          <span className="pl-money">
            <NumberField
              value={eur_per_person}
              emptyIsZero
              onCommit={(value) => setIntervention(id, { eur_per_person: value })}
            />
            <span aria-hidden="true">€</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

export default function AssumptionsEditor() {
  const t = useCopy().planner;
  const interventions = useStore((s) => s.interventions);
  const setIntervention = useStore((s) => s.setIntervention);
  const edited = interventions.some(isEdited);

  const restore = () => initialInterventions.forEach(({ id, reach_share, fixed_eur, eur_per_person }) => {
    setIntervention(id, { reach_share, fixed_eur, eur_per_person });
  });

  return (
    <Group
      title={t.assumptionsTitle}
      recap={edited ? t.assumptionsEdited : t.assumptionsDefault}
      className="pl-assumptions"
    >
      <p className="pl-assumptions__notice">{t.assumptionsNotice}</p>
      {interventions.length === 0 && <p className="pl-note">{t.assumptionsEmpty}</p>}
      {interventions.map((intervention) => (
        <AssumptionRow key={intervention.id} intervention={intervention} />
      ))}
      {edited && (
        <button type="button" className="pl-link" onClick={restore}>
          {t.restore}
        </button>
      )}
    </Group>
  );
}
