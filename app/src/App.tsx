import { useEffect } from 'react';
import { LANGS } from './i18n';
import { useCopy, useStore } from './store';
import { formatInt } from './components/planner/format';
import MapView from './components/map/MapView';
import PlannerPanel from './components/planner/PlannerPanel';
import CommandBar from './components/assistant/CommandBar';
import MemoView from './components/memo/MemoView';

/** The compass the product is named after: four points, the needle on north-east. */
function Mark() {
  return (
    <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16.2 7.8 10.9 10.9 7.8 16.2 13.1 13.1Z" fill="currentColor" />
    </svg>
  );
}

/**
 * English is the source language; Italian is the one the room speaks. The switch is in the
 * masthead rather than in a settings menu so it can be thrown mid-demo.
 */
function LangSwitch() {
  const t = useCopy().app;
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  return (
    <div className="lang-switch" role="group" aria-label={t.langAria}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === lang}
          onClick={() => setLang(code)}
        >
          {t.langName[code]}
        </button>
      ))}
    </div>
  );
}

/** What is on the table: the counts come from the loaded files, never from a constant. */
function DataStrip() {
  const t = useCopy().app;
  const zones = useStore((s) => s.zones);
  const services = useStore((s) => s.services);
  const funded = useStore((s) => s.funded);
  const sources = useStore((s) => s.meta?.sources);
  if (!zones) return null;

  const counts: [number, string][] = [
    [zones.features.length, t.dataLabels.zones],
    [services?.features.length ?? 0, t.dataLabels.services],
    [funded.length, t.dataLabels.projects],
    [sources?.length ?? 0, t.dataLabels.sources],
  ];

  return (
    <dl className="data-strip" aria-label={t.dataAria}>
      {counts.map(([count, label]) => (
        <div key={label}>
          <dd>{formatInt(count)}</dd>
          <dt>{label}</dt>
        </div>
      ))}
    </dl>
  );
}

export default function App() {
  const t = useCopy().app;
  const load = useStore((s) => s.load);
  const meta = useStore((s) => s.meta);
  const loadError = useStore((s) => s.loadError);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="shell">
      {/* The map is the floor of the app; everything else floats over it. */}
      <div className="stage"><MapView /></div>

      <header className="hud">
        <div className="hud__brand">
          <span className="brand">
            <Mark />
            <span className="brand__name">Bussola</span>
          </span>
          <p className="brand__line">{t.brandLine}</p>
        </div>
        <div className="hud__ask"><CommandBar /></div>
        <div className="hud__data">
          <LangSwitch />
          <DataStrip />
        </div>
      </header>

      <aside className="rail"><PlannerPanel /></aside>

      {meta?.mock && <div className="mock-banner">{t.mockBanner}</div>}
      {loadError && <div className="error-banner">{t.loadError}{loadError}</div>}

      <MemoView />
    </div>
  );
}
