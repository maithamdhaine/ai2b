// Writes mock data files in the exact contract shape. Real files replace them with no code changes.
import { mkdirSync, writeFileSync } from 'node:fs';

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const int = (a, b) => Math.round(a + rnd() * (b - a));

const out = new URL('../public/data/', import.meta.url);
mkdirSync(out, { recursive: true });

const cols = 10, rows = 10, lat0 = 45.01, lat1 = 45.14, lon0 = 7.58, lon1 = 7.77;
const dLat = (lat1 - lat0) / rows, dLon = (lon1 - lon0) / cols;
const features = [];
for (let i = 0; i < 94; i++) {
  const c = i % cols, r = Math.floor(i / cols);
  const x = lon0 + c * dLon, y = lat0 + r * dLat;
  const small = i % 31 === 1;
  const pop = small ? int(100, 800) : int(3000, 22000);
  const over65 = Math.round(pop * (0.2 + rnd() * 0.12));
  const over75 = Math.round(over65 * (0.45 + rnd() * 0.12));
  const funded = rnd() > 0.7 ? int(100000, 3000000) : 0;
  features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[x, y], [x + dLon, y], [x + dLon, y + dLat], [x, y + dLat], [x, y]]] },
    properties: {
      id: i + 1, name: `Zona di prova ${i + 1}`, circ: (i % 8) + 1,
      pop_2025: pop, over65_est: over65, over75_est: over75,
      adults_50_64_est: Math.round(pop * (0.18 + rnd() * 0.06)),
      over75_2030: i % 9 === 0 ? null : Math.round(over75 * (0.95 + rnd() * 0.3)),
      alone_rate_circ: +(0.32 + rnd() * 0.15).toFixed(3),
      foreign_share: +(0.05 + rnd() * 0.3).toFixed(3),
      isolation: int(0, 100), service_gap: int(0, 100), future_pressure: int(0, 100), inclusion: int(0, 100),
      funded_eur: funded, funded_projects: funded ? int(1, 4) : 0, funded_share: +(funded / 3000000).toFixed(3),
      nearest: { health_m: int(150, 2500), care_m: int(150, 3000), pharmacy_m: i % 7 === 0 ? null : int(50, 900) },
      services_800m: int(0, 12), stability_top10: i % 5 === 0 ? null : +rnd().toFixed(2),
      confidence: ['official', 'estimated', 'low'][i % 3], small_zone: small,
    },
  });
}
writeFileSync(new URL('zones.geojson', out), JSON.stringify({ type: 'FeatureCollection', features }));

const types = ['hospital', 'rsa', 'pharmacy', 'library', 'market'];
const services = Array.from({ length: 60 }, (_, i) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon0 + rnd() * (lon1 - lon0), lat0 + rnd() * (lat1 - lat0)] },
  properties: { id: i + 1, name: `Servizio di prova ${i + 1}`, type: types[i % 5], address: `Via di Prova ${i + 1}`, source: 'mock', year: 2026 },
}));
writeFileSync(new URL('services.geojson', out), JSON.stringify({ type: 'FeatureCollection', features: services }));

const funded = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, title: `Progetto di prova ${i + 1}`, programme: i % 2 ? 'PNRR' : 'PNC', amount_eur: int(100000, 3000000),
  progress_pct: int(0, 100), circ: i === 11 ? null : (i % 8) + 1, zone_id: i < 8 ? i + 1 : null, theme: 'Sociale', source: 'mock',
}));
writeFileSync(new URL('funded.json', out), JSON.stringify(funded));

writeFileSync(new URL('meta.json', out), JSON.stringify({
  mock: true, generated_at: new Date().toISOString(),
  sources: [{ key: 'mock', label: 'Dati di prova', url: '', year: 2026, level: 'zona' }],
}));
console.log('mock data written');
