import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { ServiceType } from '../../types';
import { HatchDefs, LensBar, MapLegend, ServiceToggle } from './MapControls';
import ZonePanel from './ZonePanel';
import { SERVICE_ORDER, lensValue } from './mapConfig';
import { ZoneMap } from './zoneMap';
import './map.css';

const OVERLAY_GAP = 16; // matches the padding of .map-overlay
// The planner rail floats over the map but is owned by App, so the map cannot measure it.
// Both numbers live in styles.css as --rail-w and --hud-h; keep the three in step.
const RAIL_WIDTH = 436;
const HUD_HEIGHT = 128;

export default function MapView() {
  const zones = useStore((s) => s.zones);
  const services = useStore((s) => s.services);
  const funded = useStore((s) => s.funded);
  const meta = useStore((s) => s.meta);
  const lens = useStore((s) => s.lens);
  const plan = useStore((s) => s.plan);
  const selectedId = useStore((s) => s.selected_zone_id);
  const setLens = useStore((s) => s.setLens);
  const selectZone = useStore((s) => s.selectZone);

  const [shownServices, setShownServices] = useState<ServiceType[]>([]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const zoneMapRef = useRef<ZoneMap | null>(null);
  const clickedZoneRef = useRef<number | null>(null);

  const planIds = useMemo(() => new Set(plan.map((item) => item.zone_id)), [plan]);
  const selectedZone = useMemo(
    () => zones?.features.find((feature) => feature.properties.id === selectedId)?.properties ?? null,
    [zones, selectedId],
  );
  const projects = useMemo(() => funded.filter((project) => project.zone_id === selectedId), [funded, selectedId]);
  const hasMissing = useMemo(
    () => (zones?.features ?? []).some(
      ({ properties }) => !properties.small_zone && lensValue(properties, lens) === null,
    ),
    [zones, lens],
  );
  const serviceCounts = useMemo(() => {
    const counts = Object.fromEntries(SERVICE_ORDER.map((type) => [type, 0])) as Record<ServiceType, number>;
    for (const feature of services?.features ?? []) {
      if (feature.properties.type in counts) counts[feature.properties.type] += 1;
    }
    return counts;
  }, [services]);

  // Keeps a fitted city clear of everything floating over the map.
  const overlayInsets = () => ({
    top: HUD_HEIGHT + OVERLAY_GAP,
    right: RAIL_WIDTH + (panelRef.current?.offsetWidth ?? 0) + 2 * OVERLAY_GAP,
    left: (leftRef.current?.offsetWidth ?? 0) + 2 * OVERLAY_GAP,
  });

  const handleZoneClick = useCallback((id: number) => {
    const state = useStore.getState();
    if (state.selected_zone_id !== id) clickedZoneRef.current = id;
    state.selectZone(id);
  }, []);

  const toggleService = (type: ServiceType) => {
    setShownServices((current) => (
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    ));
  };

  // Effects run in declaration order, so the map exists before the data effects below use it.
  // Under StrictMode this one runs, cleans up and runs again on the same element.
  useEffect(() => {
    const zoneMap = new ZoneMap(canvasRef.current!, handleZoneClick);
    zoneMapRef.current = zoneMap;
    return () => {
      zoneMap.destroy();
      zoneMapRef.current = null;
    };
  }, [handleZoneClick]);

  useEffect(() => {
    zoneMapRef.current?.setZones(zones, overlayInsets());
  }, [zones]);

  useEffect(() => {
    zoneMapRef.current?.setLens(lens);
  }, [zones, lens]);

  useEffect(() => {
    zoneMapRef.current?.setOutlines(planIds, selectedId);
  }, [zones, planIds, selectedId]);

  // A selection that did not come from a map click (the AI, the ranking) pans to the zone.
  useEffect(() => {
    if (selectedId === null) return;
    const fromMapClick = clickedZoneRef.current === selectedId;
    clickedZoneRef.current = null;
    zoneMapRef.current?.focusZone(selectedId, overlayInsets(), fromMapClick ? 'reveal' : 'center');
  }, [zones, selectedId]);

  useEffect(() => {
    zoneMapRef.current?.setServices(services);
  }, [services]);

  useEffect(() => {
    zoneMapRef.current?.showServices(shownServices);
  }, [services, shownServices]);

  return (
    <div className={`map-root${selectedZone ? ' map-root--panel-open' : ''}`}>
      <HatchDefs />
      <div ref={canvasRef} className="map-canvas" />
      <div className="map-overlay">
        <div className="map-overlay__body">
          <div ref={leftRef} className="map-overlay__left">
            <div className="map-card map-lenses">
              <LensBar lens={lens} onChange={setLens} />
              <button
                type="button"
                className="map-city-button"
                onClick={() => zoneMapRef.current?.fitCity(overlayInsets(), true)}
              >
                Tutta la città
              </button>
            </div>
            <ServiceToggle counts={serviceCounts} shown={shownServices} onToggle={toggleService} />
            <MapLegend lens={lens} hasMissing={hasMissing} />
          </div>
          {selectedZone && (
            <div ref={panelRef} className="map-overlay__panel">
              <ZonePanel
                key={selectedZone.id}
                zone={selectedZone}
                projects={projects}
                sources={meta?.sources ?? []}
                inPlan={planIds.has(selectedZone.id)}
                onClose={() => selectZone(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
