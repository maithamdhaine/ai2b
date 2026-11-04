import { useEffect } from 'react';
import { useStore } from './store';
import MapView from './components/map/MapView';
import PlannerPanel from './components/planner/PlannerPanel';
import CommandBar from './components/assistant/CommandBar';
import MemoView from './components/memo/MemoView';

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
