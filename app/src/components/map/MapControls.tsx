import type { Lens, ServiceType } from '../../types';
import { formatInteger } from './format';
import {
  HATCH_ID, LENSES, LENS_ORDER, MISSING_FILL, SERVICES, SERVICE_ORDER, ZONE_FILL_OPACITY, lensClasses,
} from './mapConfig';

/** The pattern the map and the legend both use for small zones. It must stay in the document. */
export function HatchDefs() {
  return (
    <svg className="map-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <pattern id={HATCH_ID} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="map-hatch-ground" width="7" height="7" />
          <line className="map-hatch-line" x1="1" y1="0" x2="1" y2="7" />
        </pattern>
      </defs>
    </svg>
  );
}

export function LensBar({ lens, onChange }: { lens: Lens; onChange: (lens: Lens) => void }) {
  return (
    <div className="map-card map-lens-bar" role="group" aria-label="Lente della mappa">
      {LENS_ORDER.map((id) => (
        <button key={id} type="button" aria-pressed={id === lens} onClick={() => onChange(id)}>
          {LENSES[id].label}
        </button>
      ))}
    </div>
  );
}

export function MapLegend({ lens, hasMissing }: { lens: Lens; hasMissing: boolean }) {
  const { label, note, scale } = LENSES[lens];
  return (
    <section className="map-card map-legend" aria-label="Legenda">
      <h2 className="map-legend__title">{label}</h2>
      <p className="map-legend__note">{note} {scale}</p>
      <ul className="map-legend__list">
        {lensClasses(lens).reverse().map((item) => (
          <li key={item.label}>
            <span
              className="map-legend__swatch"
              style={{ background: item.color, opacity: ZONE_FILL_OPACITY }}
            />
            {item.label}
          </li>
        ))}
      </ul>
      <ul className="map-legend__list map-legend__list--keys">
        <li><span className="map-legend__swatch map-legend__swatch--plan" />Zona nel piano</li>
        <li><span className="map-legend__swatch map-legend__swatch--selected" />Zona selezionata</li>
        <li>
          <svg className="map-legend__swatch" aria-hidden="true">
            <rect width="100%" height="100%" fill={`url(#${HATCH_ID})`} />
          </svg>
          Esclusa dalla classifica
        </li>
        {hasMissing && (
          <li><span className="map-legend__swatch" style={{ background: MISSING_FILL }} />Dato non disponibile</li>
        )}
      </ul>
    </section>
  );
}

interface ServiceToggleProps {
  counts: Record<ServiceType, number>;
  shown: readonly ServiceType[];
  onToggle: (type: ServiceType) => void;
}

export function ServiceToggle({ counts, shown, onToggle }: ServiceToggleProps) {
  return (
    <details className="map-card map-services">
      <summary>Punti di servizio</summary>
      <ul>
        {SERVICE_ORDER.map((type) => (
          <li key={type}>
            <label>
              <input type="checkbox" checked={shown.includes(type)} onChange={() => onToggle(type)} />
              <span className="map-service-marker" aria-hidden="true">{SERVICES[type].glyph}</span>
              {SERVICES[type].label}
              <span className="map-services__count">{formatInteger(counts[type])}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
