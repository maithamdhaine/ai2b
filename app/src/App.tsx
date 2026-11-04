import { useEffect } from 'react';
import { useStore } from './store';
import { formatInt } from './components/planner/format';
import MapView from './components/map/MapView';
import PlannerPanel from './components/planner/PlannerPanel';
import CommandBar from './components/assistant/CommandBar';
import MemoView from './components/memo/MemoView';

/** What is on the table: the counts come from the loaded files, never from a constant. */
function DataStrip() {
  const zones = useStore((s) => s.zones);
  const services = useStore((s) => s.services);
  const funded = useStore((s) => s.funded);
  const sources = useStore((s) => s.meta?.sources);
  if (!zones) return null;

  const counts: [number, string][] = [
    [zones.features.length, 'zone'],
    [services?.features.length ?? 0, 'punti di servizio'],
    [funded.length, 'progetti finanziati'],
    [sources?.length ?? 0, 'fonti'],
  ];

  return (
    <p className="topbar__data" aria-label="Dati caricati">
      {counts.map(([count, label]) => (
        <span key={label}><b>{formatInt(count)}</b> {label}</span>
      ))}
    </p>
  );
}

export default function App() {
  const load = useStore((s) => s.load);
  const meta = useStore((s) => s.meta);
  const loadError = useStore((s) => s.loadError);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="shell">
      {meta?.mock && <div className="mock-banner">DATI DI PROVA</div>}
      {loadError && <div className="error-banner">Dati non caricati: {loadError}</div>}
      <header className="topbar">
        <h1>Bussola</h1>
        <p>Dove investire per il massimo ritorno sociale a Torino</p>
        <DataStrip />
      </header>
      <CommandBar />
      <main className="workspace">
        <section className="map-area"><MapView /></section>
        <aside className="side-area"><PlannerPanel /></aside>
      </main>
      <MemoView />
    </div>
  );
}
