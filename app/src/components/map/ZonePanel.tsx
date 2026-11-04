import type { Confidence, FundedProject, SourceRef, ZoneProps } from '../../types';
import {
  formatEuro, formatInteger, formatMeters, formatPercentage, formatShare, isNumber,
} from './format';
import { LENSES, NEED_LENSES, lensValue } from './mapConfig';

const CONFIDENCE: Record<Confidence, string> = {
  official: 'Dato ufficiale',
  estimated: 'Stima',
  low: 'Bassa affidabilità',
};

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
  return (
    <li className="zone-project">
      <div className="zone-project__title">{project.title}</div>
      <div>{project.programme} · {formatEuro(project.amount_eur)}</div>
      <div className="zone-project__meta">
        Avanzamento {formatPercentage(project.progress_pct)} · {project.theme} · Fonte: {project.source}
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
  const estimateTag = zone.confidence === 'official' ? undefined : 'stima';
  const confidence = CONFIDENCE[zone.confidence];

  return (
    <aside className="map-card zone-panel" aria-label={`Scheda zona ${zone.name}`}>
      <header className="zone-panel__head">
        <h2>{zone.name}</h2>
        <p>Circoscrizione {formatInteger(zone.circ)}</p>
        <div className="zone-panel__badges">
          {confidence && <span className={`zone-badge zone-badge--${zone.confidence}`}>{confidence}</span>}
          {inPlan && <span className="zone-badge zone-badge--plan">Nel piano</span>}
        </div>
        <button type="button" className="zone-panel__close" aria-label="Chiudi scheda zona" onClick={onClose}>
          ×
        </button>
      </header>

      {zone.small_zone && (
        <p className="zone-panel__notice">Zona piccola, sotto 1.000 residenti: esclusa dalla classifica.</p>
      )}

      <section className="zone-panel__section">
        <h3>Popolazione</h3>
        <dl className="zone-figures">
          <Figure label="Residenti 2025" value={formatInteger(zone.pop_2025)} />
          <Figure label="Over 65" tag={estimateTag} value={formatInteger(zone.over65_est)} />
          <Figure label="Over 75" tag={estimateTag} value={formatInteger(zone.over75_est)} />
          <Figure label="Vivono sole" tag="dato di Circoscrizione" value={formatShare(zone.alone_rate_circ)} />
        </dl>
      </section>

      <section className="zone-panel__section">
        <h3>Punteggi di bisogno (0-100)</h3>
        <ul className="zone-scores">
          {NEED_LENSES.map((lens) => (
            <ScoreBar key={lens} label={LENSES[lens].label} value={lensValue(zone, lens)} />
          ))}
        </ul>
        {isNumber(zone.stability_top10) && (
          <dl className="zone-figures zone-figures--spaced">
            <Figure label="Resta tra le prime 10 con pesi casuali" value={formatShare(zone.stability_top10)} />
          </dl>
        )}
      </section>

      <section className="zone-panel__section">
        <h3>Vicinanza ai servizi</h3>
        <dl className="zone-figures">
          <Figure label="Presidio sanitario più vicino" value={formatMeters(zone.nearest?.health_m)} />
          <Figure label="Struttura di cura più vicina" value={formatMeters(zone.nearest?.care_m)} />
          <Figure label="Farmacia più vicina" value={formatMeters(zone.nearest?.pharmacy_m)} />
          <Figure label="Servizi entro 800 m" value={formatInteger(zone.services_800m)} />
        </dl>
      </section>

      <section className="zone-panel__section">
        <h3>Già finanziato</h3>
        <dl className="zone-figures">
          <Figure label="Importo" value={formatEuro(zone.funded_eur)} />
          <Figure label="Progetti" value={formatInteger(zone.funded_projects)} />
        </dl>
        {projects.length > 0 ? (
          <ul className="zone-projects">
            {projects.map((project) => <ProjectItem key={project.id} project={project} />)}
          </ul>
        ) : (
          <p className="zone-panel__empty">Nessun progetto localizzato in questa zona.</p>
        )}
      </section>

      {sources.length > 0 && (
        <section className="zone-panel__section zone-panel__sources">
          <h3>Fonti e anno dei dati</h3>
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
