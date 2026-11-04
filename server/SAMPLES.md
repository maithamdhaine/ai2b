# Sample responses for Machine A

These are real responses captured from the running server in rules mode. LLM mode returns the same shape with `"mode": "llm"`, and its wording and weights can differ. Raw files are in `samples/`. `samples/prompts.responses.json` has all 10 demo prompts.

## 1. A full request: `POST /api/agent`

Request message: `ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR`

```json
{
  "reply": "Ricalcolo il piano con budget di 200.000 € e priorità all'isolamento degli anziani, senza le zone già finanziate. In primo piano: impatto e difendibilità della scelta davanti al consiglio.",
  "actions": [
    {"tool": "set_budget", "args": {"budget_eur": 200000}},
    {"tool": "set_weights", "args": {"isolation": 0.55, "service_gap": 0.225, "future_pressure": 0.162, "inclusion": 0.063}},
    {"tool": "filter_zones", "args": {"exclude_funded": true}},
    {"tool": "run_plan", "args": {}}
  ],
  "needs_clarification": false,
  "mode": "rules"
}
```

## 2. A question back to the user: `POST /api/agent`

Request message: `Voglio aiutare gli anziani soli`

The understood settings still come back, with no `run_plan`. Apply them and show the question. The user's next message goes in `messages` together with the earlier ones.

```json
{
  "reply": "Quale budget vuoi destinare all'isolamento degli anziani?",
  "actions": [
    {"tool": "set_weights", "args": {"isolation": 0.55, "service_gap": 0.225, "future_pressure": 0.162, "inclusion": 0.063}}
  ],
  "needs_clarification": true,
  "mode": "rules"
}
```

## 3. The memo: `POST /api/memo`

Request: `samples/memo-request.json`. Response: `samples/memo.response.json`. The shape is below, with the markdown shortened here. It has six `##` sections in this order: Sintesi, Dove investire (a markdown table), Perché queste zone, Cosa è già finanziato, Limiti dei dati, Fonti.

```json
{
  "markdown": "> **DATI DI PROVA**: questo memo usa dati fittizi e non va usato per decisioni reali.\n\n## Sintesi\n\nRaccomandiamo di destinare il prossimo investimento a Pilonetto e Zona di prova, ...",
  "mode": "rules"
}
```

## Notes for the app

- Apply `actions` in the order given.
- `reply` is always a non-empty string, so show it in the chat.
- Render the memo as markdown, including tables and blockquotes.
- Ignore a `select_zone` whose `zone_id` is not in your data. The server cannot see the zones, so it only checks that the id is in the plan or was typed by the user.
- `filter_zones` args are partial: change only the fields present. `circ: []` means all Circoscrizioni.
- Optional: send `"mock": true` in `POST /api/memo` when `meta.json` says mock, and the memo opens with the DATI DI PROVA line.
- Send only the plan's zones in `zones` if you can. The server filters to them anyway.
