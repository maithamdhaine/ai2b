import L from 'leaflet';
import type { MultiPolygon, Polygon } from 'geojson';
import type {
  Lens, ServiceCollection, ServiceProps, ServiceType, ZoneCollection, ZoneFeature, ZoneProps,
} from '../../types';
import { DEFAULT_LANG, copyFor, type Lang } from '../../i18n';
import { SERVICE_GLYPHS, formatLensValue, lensText, lensValue, zoneFill } from './mapConfig';

const TURIN: L.LatLngTuple = [45.0703, 7.6869];
const EDGE = 16; // px kept clear between a fitted shape and the map edge
const MIN_FREE_WIDTH = 200; // below this, centring ignores the legend so a zone still fits
const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// CARTO tiles now carry an "API key required" watermark on every URL without a key, so Positron is
// used only when VITE_CARTO_KEY is set. Esri Light Gray Canvas is the same kind of quiet basemap
// with separate labels, and it needs no key.
const CARTO_KEY: string | undefined = import.meta.env.VITE_CARTO_KEY;
const cartoTiles = (style: string) =>
  `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;
const esriTiles = (service: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${service}/MapServer/tile/{z}/{y}/{x}`;

const BASEMAP = CARTO_KEY
  ? {
    base: cartoTiles('light_nolabels'),
    labels: cartoTiles('light_only_labels'),
    attribution: `&copy; ${OSM_LINK} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
    maxNativeZoom: 20,
  }
  : {
    base: esriTiles('World_Light_Gray_Base'),
    labels: esriTiles('World_Light_Gray_Reference'),
    attribution: `Tiles &copy; Esri, HERE, Garmin, &copy; ${OSM_LINK}, and the GIS user community`,
    maxNativeZoom: 16,
  };

// Panes above the zone fills (overlayPane, 400). Neither takes the pointer, so hover and click
// still reach the zones underneath.
const LABEL_PANE = 'bussola-labels';
const OUTLINE_PANE = 'bussola-outlines';

/** Pixels of the map covered by the floating controls. */
export interface Insets {
  top: number;
  right: number;
  left: number;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function tooltipNode(title: string, lines: string[]): HTMLElement {
  const root = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title;
  root.append(heading);
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    root.append(row);
  }
  return root;
}

function zoneTooltip(zone: ZoneProps, lens: Lens, lang: Lang): HTMLElement {
  const t = copyFor(lang).map;
  const lines = [`${lensText(lens, lang).label}: ${formatLensValue(lensValue(zone, lens), lens, lang)}`];
  if (zone.small_zone) lines.push(t.smallZoneTooltip);
  return tooltipNode(zone.name, lines);
}

function serviceTooltip(service: ServiceProps, lang: Lang): HTMLElement {
  const t = copyFor(lang).map;
  const lines = [t.services[service.type].singular];
  if (service.address) lines.push(service.address);
  lines.push(t.sourceLine(service.source, service.year));
  return tooltipNode(service.name, lines);
}

/**
 * Everything Leaflet-specific. React owns one instance in a ref and pushes store changes into it,
 * so the zone layer is built once per data load and only restyled afterwards.
 */
export class ZoneMap {
  private readonly map: L.Map;
  private readonly outlines = L.layerGroup();
  private readonly hover: L.GeoJSON;
  private readonly resizeObserver: ResizeObserver;
  private readonly colors = {
    ink: token('--ink', '#1d2733'),
    muted: token('--muted', '#5d6875'),
    warn: token('--warn', '#a8501c'),
    casing: token('--surface', '#ffffff'),
  };
  private zoneLayer: L.GeoJSON<ZoneProps, Polygon | MultiPolygon> | null = null;
  private zonePaths = new Map<number, L.Polygon>();
  private zoneFeatures = new Map<number, ZoneFeature>();
  private serviceGroups = new Map<ServiceType, L.LayerGroup>();
  private lens: Lens = 'isolation';
  private lang: Lang = DEFAULT_LANG;

  constructor(container: HTMLElement, private readonly onZoneClick: (id: number) => void) {
    this.map = L.map(container, {
      center: TURIN, zoom: 12, minZoom: 10, maxZoom: 17, zoomSnap: 0.25, zoomDelta: 0.5, zoomControl: false,
    });
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Ingrandisci', zoomOutTitle: 'Riduci' }).addTo(this.map);

    for (const [name, zIndex] of [[LABEL_PANE, '430'], [OUTLINE_PANE, '450']]) {
      const pane = this.map.createPane(name);
      pane.style.zIndex = zIndex;
      pane.style.pointerEvents = 'none';
    }

    // Base and labels are separate layers, so place names stay readable on top of the dark classes.
    const { base, labels, attribution, maxNativeZoom } = BASEMAP;
    L.tileLayer(base, { attribution, maxNativeZoom }).addTo(this.map);
    L.tileLayer(labels, { pane: LABEL_PANE, maxNativeZoom }).addTo(this.map);

    this.outlines.addTo(this.map);
    this.hover = L.geoJSON(undefined, {
      pane: OUTLINE_PANE, interactive: false, style: { fill: false, color: this.colors.ink, weight: 1.5 },
    }).addTo(this.map);

    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(container);
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.map.remove();
  }

  setZones(zones: ZoneCollection | null, insets: Insets) {
    this.zoneLayer?.remove();
    this.zoneLayer = null;
    this.zonePaths.clear();
    this.zoneFeatures.clear();
    this.hover.clearLayers();
    if (!zones) return;

    this.zoneLayer = L.geoJSON<ZoneProps, Polygon | MultiPolygon>(zones, {
      style: (feature) => (feature ? this.zoneStyle(feature.properties) : {}),
      onEachFeature: (feature, layer) => this.bindZone(feature, layer as L.Polygon),
    }).addTo(this.map);
    this.fitCity(insets, false);
  }

  fitCity(insets: Insets, animate: boolean) {
    const bounds = this.zoneLayer?.getBounds();
    if (!bounds?.isValid()) return;
    this.map.fitBounds(bounds, {
      paddingTopLeft: [insets.left, insets.top], paddingBottomRight: [EDGE, EDGE], animate,
    });
  }

  /** Tooltips are bound as functions, so they read this the next time one opens. */
  setLang(lang: Lang) {
    this.lang = lang;
  }

  setLens(lens: Lens) {
    this.lens = lens;
    this.zoneLayer?.setStyle((feature) => (feature ? this.zoneStyle(feature.properties) : {}));
  }

  /** Redraws the plan and selection outlines, each with a pale casing so it reads on every class. */
  setOutlines(planIds: ReadonlySet<number>, selectedId: number | null) {
    this.outlines.clearLayers();
    const features = [...this.zoneFeatures.values()];
    const selected = features.filter((feature) => feature.properties.id === selectedId);
    const planned = features.filter(
      (feature) => planIds.has(feature.properties.id) && feature.properties.id !== selectedId,
    );
    const { ink, warn, casing } = this.colors;
    this.drawOutline(planned, casing, 5);
    this.drawOutline(planned, ink, 2.5);
    this.drawOutline(selected, casing, 7);
    this.drawOutline(selected, warn, 3.5);
  }

  /**
   * 'center' moves the zone into the part of the map free of controls, keeping the zoom unless the
   * zone would not fit. 'reveal' is for a zone the user just clicked: it moves only if the panel
   * would otherwise cover it.
   */
  focusZone(id: number, insets: Insets, mode: 'center' | 'reveal') {
    const path = this.zonePaths.get(id);
    if (!path) return;
    const bounds = path.getBounds();
    const paddingBottomRight: L.PointTuple = [insets.right, EDGE];
    if (mode === 'reveal') {
      this.map.panInside(bounds.getCenter(), { paddingTopLeft: [EDGE, insets.top], paddingBottomRight });
      return;
    }
    const freeWidth = this.map.getSize().x - insets.left - insets.right;
    this.map.fitBounds(bounds, {
      paddingTopLeft: [freeWidth >= MIN_FREE_WIDTH ? insets.left : EDGE, insets.top],
      paddingBottomRight,
      maxZoom: this.map.getZoom(),
      animate: true,
      duration: 0.6,
    });
  }

  setServices(services: ServiceCollection | null) {
    for (const group of this.serviceGroups.values()) group.remove();
    this.serviceGroups.clear();
    for (const feature of services?.features ?? []) {
      const service = feature.properties;
      const glyph = SERVICE_GLYPHS[service.type];
      const coordinates = feature.geometry?.coordinates;
      if (!glyph || !coordinates) continue;

      let group = this.serviceGroups.get(service.type);
      if (!group) {
        group = L.layerGroup();
        this.serviceGroups.set(service.type, group);
      }
      const icon = L.divIcon({ className: 'map-service-marker', html: glyph, iconSize: [20, 20] });
      L.marker([coordinates[1], coordinates[0]], { icon, keyboard: false })
        .bindTooltip(() => serviceTooltip(service, this.lang), {
          direction: 'top', offset: [0, -10], opacity: 1, className: 'map-tooltip',
        })
        .addTo(group);
    }
  }

  showServices(types: readonly ServiceType[]) {
    this.serviceGroups.forEach((group, type) => {
      if (types.includes(type)) group.addTo(this.map);
      else group.remove();
    });
  }

  private zoneStyle(zone: ZoneProps): L.PathOptions {
    return {
      ...zoneFill(zone, this.lens),
      color: this.colors.muted,
      weight: 0.8,
      opacity: 0.6,
      dashArray: zone.small_zone ? '3 3' : undefined,
    };
  }

  private bindZone(feature: ZoneFeature, path: L.Polygon) {
    const zone = feature.properties;
    this.zonePaths.set(zone.id, path);
    this.zoneFeatures.set(zone.id, feature);
    // A function, so the tooltip always shows the lens active when it opens.
    path.bindTooltip(() => zoneTooltip(zone, this.lens, this.lang), {
      sticky: true, direction: 'top', offset: [0, -6], opacity: 1, className: 'map-tooltip',
    });
    path.on({
      click: () => this.onZoneClick(zone.id),
      mouseover: () => {
        this.hover.clearLayers();
        this.hover.addData(feature);
      },
      mouseout: () => this.hover.clearLayers(),
    });
  }

  private drawOutline(features: ZoneFeature[], color: string, weight: number) {
    if (features.length === 0) return;
    this.outlines.addLayer(L.geoJSON(features, {
      pane: OUTLINE_PANE, interactive: false, style: { fill: false, color, weight, opacity: 1 },
    }));
  }
}
