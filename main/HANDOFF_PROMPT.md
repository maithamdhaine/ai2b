# Handoff: take over Machine A, the Bussola web app

You are taking over from another Claude session that hit its usage limit. Continue the work, and don't restart or redesign it. Start right away. Ask only if truly blocked.

**Project folder:** `C:\Users\MAITH\Desktop\ai2b - comp`. The app is in `app/`.

**Read first:**

1. `team/PROMPT_MACHINE_A_APP.md`: full context, product rules, shared contract, and API.
2. `app/src/types.ts` and `app/src/store.ts`: shared types and state.
3. `app/src/lib/planner.ts` and `app/src/data/interventions.ts`: scoring.

Other prompts are in `team/`: `PROMPT_MACHINE_B_AI.md` and `PROMPT_MACHINE_C_DATA.md`.

## The situation

We are in the AI2B Games competition at UniTo, Torino, on Traccia 3 Welfare. Any AI tool is allowed. Code freezes at **15:30**, and we present live at **16:00** for about 5 minutes from this laptop.

We are building Bussola, a funding decision tool for Turin. It answers: "Where should the next 100,000 euro go, and what is already funded there?" UI and memo are in Italian.

- **Machine A (this laptop):** web app and final demo.
- **Machine B:** AI server on port 8787, in `ai2b/server`.
- **Machine C:** real data files, in `ai2b/pipeline`.
- **Team tracker:** https://docs.google.com/document/d/1Zas0rMZdcxJuhlP2wRnn4qvrUza-yb2PVEY3w31vcQU/edit?usp=sharing. Log status in the Machine A tab. If you can't write there, print a status block for the human to paste.
- **Plan doc:** https://claude.ai/artifact/FCueUy3BQNsmYBMme8YtPC. The owner may need to share it with this account.

## State at 12:51

All work is committed at `6c52e0e`. `npx tsc --noEmit` is clean, and `npx vitest run` passes 206 tests. Mock data is in `app/public/data/`.

- **Map:** finished, in `src/components/map/`. It uses an Esri Light Gray basemap, because CARTO now needs a key.
- **Planner screen:** finished, in `src/components/planner/`.
- **Planner logic:** an agent was interrupted while changing it. `fit`, `depth` and the formula are in, but confirm everything below.
- **AI bar and memo:** an agent was interrupted while editing. Files exist in `src/lib/api.ts`, `src/components/assistant/` and `src/components/memo/`, and their tests pass, but treat them as unreviewed. "Nothing was changed, so I'll apply the edits one at a time" was its last message, so one planned edit may be missing.
- **Not yet done:** nobody has run `npm run dev` and viewed the full app.

## Do this, in order

1. Start the app with `npm run dev` in `app/` (`.claude/launch.json` has a `bussola` config), and check the whole flow in a browser.
2. **Finish planner logic.** Required rules:
   - `pair_need` = sum of weight x fit x score, divided by the sum of weights and by 100.
   - `return_index` = people x depth x pair_need x additionality / cost.
   - Cap each zone at 35% and each intervention type at 40% of the budget.
   - Must pass on mock data: at 100k and 200k with default weights, at least 3 intervention types. With isolation dominant, `visite_domiciliari` gets the largest share. With inclusion dominant, `inserimento_lavoro` appears. With service gap dominant, `hub_prossimita` or `accesso_salute` leads.
3. **Fix the index order.** The opening screen showed rank 1 to 3 as 6,2 / 6,4 / 6,7, which looks wrong. Show the value the list is ranked by, or re-sort after allocation, then remove the footnote if it's no longer needed.
4. Review the AI bar and memo. The app must work with the server off, and every action must apply.
5. Change "Bassa affidabilità" in `map/ZonePanel.tsx` to "Affidabilità bassa".
6. In `estimateTag` in `ZonePanel.tsx`, always label 2025 over 65 and over 75 values as "stima", because zone age data stops at 2020.
7. **Integrate.** This was due at 13:00, so check the tracker for what B and C have ready. Copy C's four files into `app/public/data/`, and run B's server on port 8787 or point the proxy at it. Check that `stability_top10` and `alone_rate_circ` are on a 0 to 1 scale, and that `funded_eur` matches `funded.json`.
8. Test one typed goal through to a memo: "ho 200.000 euro, priorità agli over 75 soli, evita le zone già coperte dal PNRR".
9. After that works, polish the Italian copy and source labels. If it's stable by 14:00, add the stretch feature: a drop-a-pin simulator, where placing a new hub shows nearby older residents covered and the gap reduced. Feature freeze is at 15:00.

## Rules

- All numbers come from data or calculation. The LLM never invents them.
- Mark estimates. Call the output "indice di ritorno atteso", never SROI.
- Intervention costs, `fit`, `depth` and profile weights are team assumptions, and must be labelled as such.
- Treat foreign residents as an access and language need, never as a risk.
- The app must never show "DATI DI PROVA" in the demo. That banner means mock data is still loaded.
- Don't change the shared contract without telling Machines B and C.
- Only commit from this lead session, and end commit messages with the attribution your session requires.
- Report honestly what you tested and what you didn't.
