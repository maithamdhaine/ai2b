import { useCopy } from '../../store';
import type { FundedProject, SourceRef, ZoneProps } from '../../types';
import {
  formatEuro, formatInteger, formatMeters, formatPercentage, formatShare, isNumber,
} from './format';
import { NEED_LENSES, lensText, lensValue } from './mapConfig';

interface FigureProps {
  label: string;
  tag?: string;
  value: string;
}

function Figure({ label, tag, value }: FigureProps) {
  return (
    <>
      <dt>{label}{tag && <span className="zone-tag">{tag}</span>}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const width = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <li className="zone-score">
      <span>{label}</span>
      <span className="zone-score__track">
        <span className="zone-score__fill" style={{ width: `${width}%` }} />
      </span>
      <span className="zone-score__value">{formatInteger(value)}</span>
    </li>
  );
}

function ProjectItem({ project }: { project: FundedProject }) {
  const t = useCopy().zone;
  return (
    <li className="zone-project">
      <div className="zone-project__title">{project.title}</div>
      <div>{project.programme} · {formatEuro(project.amount_eur)}</div>
      <div className="zone-project__meta">
        {t.progress} {formatPercentage(project.progress_pct)} · {project.theme} · {t.source}: {project.source}
      </div>
    </li>
  );
}

export interface ZonePanelProps {
  zone: ZoneProps;
  projects: FundedProject[];
  sources: SourceRef[];
  inPlan: boolean;
  onClose: () => void;
}

export default function ZonePanel({ zone, projects, sources, inPlan, onClose }: ZonePanelProps) {
  const copy = useCopy();
  const t = copy.zone;
  // Zone-level age data stops at 2020, so every 2025 age figure here is projected forward,
  // however reliable the rest of the zone's data is.
  const estimateTag = t.estimateTag;
  const confidence = copy.planner.confidence[zone.confidence];

  return (
    <aside className="map-card zone-panel" aria-label={t.panelAria(zone.name)}>
      <header className="zone-panel__head">
        <h2>{zone.name}</h2>
        <p>{t.circ(formatInteger(zone.circ))}</p>
        <div className="zone-panel__badges">
          {confidence && <span className={`zone-badge zone-badge--${zone.confidence}`}>{confidence}</span>}
          {inPlan && <span className="zone-badge zone-badge--plan">{t.inPlan}</span>}
        </div>
        <button type="button" className="zone-panel__close" aria-label={t.closeAria} onClick={onClose}>
          ×
        </button>
      </header>

      {zone.small_zone && (
        <p className="zone-panel__notice">{t.smallZone}</p>
      )}

      <section className="zone-panel__section">
        <h3>{t.sections.population}</h3>
        <dl className="zone-figures">
          <Figure label={t.residents} value={formatInteger(zone.pop_2025)} />
          <Figure label={t.over65} tag={estimateTag} value={formatInteger(zone.over65_est)} />
          <Figure label={t.over75} tag={estimateTag} value={formatInteger(zone.over75_est)} />
          <Figure label={t.aloneRate} tag={t.circFigure} value={formatShare(zone.alone_rate_circ)} />
        </dl>
      </section>

      <section className="zone-panel__section">
        <h3>{t.sections.needs}</h3>
        <ul className="zone-scores">
          {NEED_LENSES.map((lens) => (
            <ScoreBar key={lens} label={lensText(lens, copy.lang).label} value={lensValue(zone, lens)} />
          ))}
        </ul>
        {isNumber(zone.stability_top10) && (
          <dl className="zone-figures zone-figures--spaced">
            <Figure label={t.stability} value={formatShare(zone.stability_top10)} />
          </dl>
        )}
      </section>

      <section className="zone-panel__section">
        <h3>{t.sections.nearby}</h3>
        <dl className="zone-figures">
          <Figure label={t.nearestHealth} value={formatMeters(zone.nearest?.health_m)} />
          <Figure label={t.nearestCare} value={formatMeters(zone.nearest?.care_m)} />
          <Figure label={t.nearestPharmacy} value={formatMeters(zone.nearest?.pharmacy_m)} />
          <Figure label={t.services800} value={formatInteger(zone.services_800m)} />
        </dl>
      </section>

      <section className="zone-panel__section">
        <h3>{t.sections.funded}</h3>
        <dl className="zone-figures">
          <Figure label={t.amount} value={formatEuro(zone.funded_eur)} />
          <Figure label={t.projects} value={formatInteger(zone.funded_projects)} />
        </dl>
        {projects.length > 0 ? (
          <ul className="zone-projects">
            {projects.map((project) => <ProjectItem key={project.id} project={project} />)}
          </ul>
        ) : (
          <p className="zone-panel__empty">{t.noProjects}</p>
        )}
      </section>

      {sources.length > 0 && (
        <section className="zone-panel__section zone-panel__sources">
          <h3>{t.sections.sources}</h3>
          <ul>
            {sources.map((source, index) => (
              <li key={`${source.key}-${index}`}>
                {source.url
                  ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
                  : source.label}
                {`, ${source.year}`}{source.level && ` (${source.level})`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
