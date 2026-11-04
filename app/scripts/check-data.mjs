// Checks public/data/ against the shared contract before the demo.
// Run after copying Machine C's files in:  npm run check-data
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'public', 'data');
const read = (name) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const note = (message) => notes.push(message);

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const inRange = (value, lo, hi) => isNum(value) && value >= lo && value <= hi;
const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);

const zones = read('zones.geojson');
const services = read('services.geojson');
const funded = read('funded.json');
const meta = read('meta.json');

// --- meta ---------------------------------------------------------------
if (meta.mock) fail('meta.json still says "mock": true, so the app shows the DATI DI PROVA banner.');
if (!Array.isArray(meta.sources) || meta.sources.length === 0) fail('meta.json carries no sources.');
else note(`${meta.sources.length} sources listed in meta.json.`);

// --- zones --------------------------------------------------------------
const props = zones.features.map((feature) => feature.properties);
note(`${props.length} zones, ${services.features.length} service points, ${funded.length} funded projects.`);

const ids = new Set();
for (const zone of props) {
  const where = `zone ${zone.id} (${zone.name})`;
  if (ids.has(zone.id)) fail(`${where}: duplicate id.`);
  ids.add(zone.id);

  for (const key of ['isolation', 'service_gap', 'future_pressure', 'inclusion']) {
    if (!inRange(zone[key], 0, 100)) fail(`${where}: ${key} is ${zone[key]}, expected 0 to 100.`);
  }
  for (const key of ['funded_share', 'alone_rate_circ', 'foreign_share']) {
    if (!inRange(zone[key], 0, 1)) fail(`${where}: ${key} is ${zone[key]}, expected 0 to 1.`);
  }
  if (zone.stability_top10 !== null && !inRange(zone.stability_top10, 0, 1)) {
    fail(`${where}: stability_top10 is ${zone.stability_top10}, expected null or 0 to 1.`);
  }
  for (const key of ['pop_2025', 'over65_est', 'over75_est', 'adults_50_64_est', 'funded_eur', 'funded_projects']) {
    if (!isNum(zone[key]) || zone[key] < 0) fail(`${where}: ${key} is ${zone[key]}, expected a number from 0 up.`);
  }
  if (!['official', 'estimated', 'low'].includes(zone.confidence)) {
    fail(`${where}: confidence is ${JSON.stringify(zone.confidence)}.`);
  }
  if (zone.over75_est > zone.over65_est) fail(`${where}: more over 75 than over 65.`);
}

const allZero = (key) => props.every((zone) => zone[key] === 0);
for (const key of ['isolation', 'service_gap', 'future_pressure', 'inclusion']) {
  if (allZero(key)) fail(`every zone has ${key} = 0: the lens and the planner have nothing to rank.`);
}
const lowConfidence = props.filter((zone) => zone.confidence === 'low').length;
if (lowConfidence === props.length) note('Every zone is confidence "low": the panel will say so on all of them.');

// --- funded_eur against funded.json -------------------------------------
const byZone = new Map();
for (const project of funded) {
  if (project.zone_id === null || project.zone_id === undefined) continue;
  if (!ids.has(project.zone_id)) fail(`funded.json: project ${project.id} points at unknown zone ${project.zone_id}.`);
  const row = byZone.get(project.zone_id) ?? { eur: 0, count: 0 };
  byZone.set(project.zone_id, { eur: row.eur + project.amount_eur, count: row.count + 1 });
}
for (const zone of props) {
  const row = byZone.get(zone.id) ?? { eur: 0, count: 0 };
  if (!near(zone.funded_eur, row.eur)) {
    fail(`zone ${zone.id} (${zone.name}): funded_eur ${zone.funded_eur} but funded.json totals ${row.eur}.`);
  }
  if (zone.funded_projects !== row.count) {
    fail(`zone ${zone.id} (${zone.name}): funded_projects ${zone.funded_projects} but funded.json has ${row.count}.`);
  }
}
note(`${byZone.size} zones carry a placed project; ${funded.filter((p) => p.zone_id == null).length} projects are citywide.`);

// --- report -------------------------------------------------------------
for (const line of notes) console.log(`  ${line}`);
if (problems.length === 0) {
  console.log('\nOK: public/data matches the contract.');
} else {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exitCode = 1;
}
