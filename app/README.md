# Bussola — app

Vite + React + TypeScript + Leaflet. No backend of its own.

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8787
npm test           # vitest
npm run build      # tsc --noEmit + vite build
npm run mock       # regenerate the mock files in public/data/
npm run check-data # check public/data/ against the shared contract
```

## Data

The app reads four files from `public/data/`: `zones.geojson`, `services.geojson`,
`funded.json`, `meta.json`. Machine C's real files replace the mock ones with no code
change. While `meta.json` says `"mock": true` the app shows a red **DATI DI PROVA**
banner, which must not be on screen during the demo. Run `npm run check-data` after
copying new files in.

## The AI server

Machine B serves `/api/health`, `/api/agent` and `/api/memo` on port 8787. With the
server off the app stays usable: the planner works on its own, the command bar says the
server is unreachable, and the memo falls back to a template built from the plan.

## Planner

`src/lib/planner.ts` is pure. For each zone-intervention pair:

```
pair_need     = sum(weight * fit * score) / sum(weight) / 100
people        = zone[target] * reach_share
cost          = fixed_eur + people * eur_per_person
additionality = 1 - 0.8 * funded_share
return_index  = people * depth * pair_need * additionality / cost
```

Money goes to the pairs greedily by `return_index`, each pair once, small zones excluded,
each zone capped at 35% and each intervention type at 40% of the budget. A pair that does
not fit whole is scaled down on its variable cost only, with a floor of 10 people. The
finished plan is then sorted again by the index each item actually shows, so the list
always reads from the highest number down.

Costs, `reach_share`, `fit` and `depth` in `src/data/interventions.ts` are **team
assumptions**, not quotes or measurements, and the UI says so. The output is an
"indice di ritorno atteso", never a measured SROI.

### A known limit of the caps

With a dominant priority and a 200.000 € budget, the two leading intervention types both
run into the 40% type cap, so which one ends a few hundred euro ahead is decided by
rounding, not by the model. Home visits in particular fill one zone's 35% cap and the
type cap then leaves too little for a second zone. So `visite_domiciliari` ranks **first**
when isolation dominates, but it is not always the largest line by euro. Lowering its
`reach_share` from 0,10 to about 0,06 would let it spread over two zones and lead on
euro as well — that number is in the shared contract, so it needs Machines B and C told.
