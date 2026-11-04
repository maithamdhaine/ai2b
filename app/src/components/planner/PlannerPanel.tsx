import { useCopy, useStore } from '../../store';
import AssumptionsEditor from './AssumptionsEditor';
import { BudgetControl, FiltersControl, ProfileControl, WeightsControl } from './Controls';
import { PlanResults, PlanSummary } from './Results';
import './planner.css';

export default function PlannerPanel() {
  const t = useCopy().planner;
  const hasPlan = useStore((s) => s.plan.length > 0);
  const requestMemo = useStore((s) => s.requestMemo);
  return (
    <div className="planner">
      <div className="pl-setup">
        <ProfileControl />
        <BudgetControl />
        <WeightsControl />
        <FiltersControl />
      </div>
      <PlanSummary />
      <PlanResults />
      <AssumptionsEditor />
      <div className="pl-footer">
        <button type="button" className="pl-memo" disabled={!hasPlan} onClick={requestMemo}>
          {t.generateMemo}
        </button>
      </div>
    </div>
  );
}
