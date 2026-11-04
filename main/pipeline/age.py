"""Age workstream: 2025 age ESTIMATES per statistical zone (IPF) and a 2030 over-75 cohort signal.

Run: python age.py   (from the pipeline folder; downloads are cached in raw/age/)

Inputs (AperTO CKAN dataset names):
  seed     popolazione-registrata-in-anagrafe-per-eta-annuale-e-zona-statistica-anno-2020
           zone x single-year age, 2020. Transposed (ages in rows, zones in columns), blanks = 0.
  targets  popolazione-residente-per-eta-e-circoscrizione-2025
           single-year age x Circoscrizione, 2025. Column residenza_virtuale is ignored.
  check    indicatori-demografici-2025 (published ageing index per Circoscrizione)
  rows     work/zones_base.csv pop_2025 (lead, from popolazione-per-sesso-e-zona-statistica-2025)

Method: zones are grouped by their assigned `circ`. For each Circoscrizione a 2D IPF is run on
the zones x single-year-age matrix seeded with the 2020 counts. Row margins = zone pop_2025.
Column margins = 2025 Circoscrizione age counts rescaled so they sum to the pop_2025 of the zones
assigned to that Circoscrizione (zones do not nest exactly). Epsilon (0.01) goes into empty cells
only when a margin has no seed mass (pass 1); if IPF still does not converge, into every empty
cell of the block (pass 2). If that fails too, the block falls back to 2020 age shares x pop_2025
(method = scaled_2020_shares).

Zone 01 seed fix (VIRTUAL_FIX): the 2020 table has no "residenza virtuale" column, while the 2025
data list it separately (code 0, 4,375 people). Zone 01 (Municipio) is the only zone whose population
fell sharply 2020 -> 2025 and its 2020 age profile is skewed to ages 15-64 like the 2025 virtual
residents, so the 2020 zone 01 count very likely includes them (inferred, not documented in the file).
Following the brief (keep residenza virtuale out of all zone rates), the excess seed_2020 - pop_2025 of
zone 01 is removed using the 2025 residenza_virtuale single-year age profile, floored at zero. This
changes the zone 01 seed (and so its over75_2030); set VIRTUAL_FIX = False to switch it off.

Rounding: per zone, the fitted ages are summed into disjoint bands 0-14, 15-49, 50-64, 65-74, 75+
and rounded with largest remainder so the rounded bands add up to pop_2025 exactly.
over65 = 65-74 + 75+.

Writes:
  work/age.csv             id, pop_2025, under15_est, over65_est, over75_est, adults_50_64_est,
                           over75_2030, seed_pop_2020, method, over75_growth, seed_note
                           (seed_pop_2020 = seed actually used; zone 01 raw total is in seed_note)
  work/age_circ_check.csv  per Circoscrizione: ageing index of the estimates vs published vs
                           computed straight from the 2025 Circoscrizione age file.

over75_2030 = residents aged 65+ in the 2020 zone table (75+ in 2030). It ignores deaths and
migration: a relative signal only, not a forecast. over75_growth = over75_2030 / over75_est.
"""
from __future__ import annotations

import csv
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import pandas as pd

from common import WORK, ckan_resources, download, read_csv_it, to_num

SUB = "age"
DS_SEED = "popolazione-registrata-in-anagrafe-per-eta-annuale-e-zona-statistica-anno-2020"
DS_CIRC = "popolazione-residente-per-eta-e-circoscrizione-2025"
DS_IND = "indicatori-demografici-2025"
# Published 2025 ageing index (indice di vecchiaia) per Circoscrizione, as given to this workstream.
# Cross-checked at run time against the indicatori-demografici-2025 file when reachable.
PUBLISHED_AI = {1: 267.6, 2: 287.0, 3: 279.7, 4: 245.6, 5: 220.6, 6: 181.2, 7: 237.5, 8: 276.3}
BIS = {"09bis": 93, "17bis": 94}
EPS = 0.01
TOL = 0.5  # convergence: max abs margin error, in people
MAX_ITER = 5000
HAND_CHECK = [1, 25, 50, 70, 88]
VIRTUAL_FIX = True  # remove inferred residenza virtuale from the 2020 zone 01 seed (see docstring)
VIRTUAL_ZONE = 1
# Disjoint bands for rounding; the output groups are unions of these.
BANDS = [("b0_14", 0, 14), ("b15_49", 15, 49), ("b50_64", 50, 64), ("b65_74", 65, 74), ("b75p", 75, 10_000)]


# ---------------------------------------------------------------- downloads and parsing
def fetch(ds: str, fname: str) -> Path:
    """Resolve the dataset's CSV resource on CKAN and download it (cached) to raw/age/<fname>."""
    path = Path(__file__).resolve().parent / "raw" / SUB / fname
    if path.exists() and path.stat().st_size > 0:
        return path
    res = ckan_resources(ds)
    csvs = [r for r in res if r["format"] == "csv" or (r["url"] or "").lower().endswith(".csv")] or res
    return download(csvs[0]["url"], fname, sub=SUB)


def source_url(ds: str) -> str | None:
    try:
        res = ckan_resources(ds)
        csvs = [r for r in res if r["format"] == "csv"] or res
        return csvs[0]["url"]
    except Exception:  # noqa: BLE001  (offline: url only used in the printed summary)
        return None


def zone_id(label: str) -> int | None:
    """'01  MUNICIPIO' -> 1, '09bis  PARCO...' / '9 bis' -> 93, '17bis' -> 94, 'TOTALE' -> None."""
    m = re.match(r"\s*(\d+)\s*(bis)?\b", str(label), flags=re.I)
    if not m:
        return None
    num = int(m.group(1))
    return BIS[f"{num:02d}bis"] if m.group(2) else num


def age_of(label: str) -> int | None:
    """'0' -> 0, '100 e oltre' -> 100 (open band counted at its first age), 'Totale' -> None."""
    if "tot" in str(label).lower():
        return None
    m = re.match(r"\s*(\d+)", str(label))
    return int(m.group(1)) if m else None


def count(s: str) -> float:
    s = (s or "").strip()
    if not s:
        return 0.0  # blank = zero people
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):  # Italian thousands separator
        s = s.replace(".", "")
    return float(s.replace(",", "."))


def read_rows(path: Path) -> list[list[str]]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    sep = ";" if first.count(";") > first.count(",") else ","
    return list(csv.reader(io.StringIO(text), delimiter=sep))


def load_seed(path: Path) -> tuple[pd.DataFrame, dict]:
    """2020 zone x age table (transposed in the file). Returns zones (index=id) x ages."""
    rows = read_rows(path)
    h = next(i for i, r in enumerate(rows) if r and re.match(r"\s*ET[AÀ]", r[0], flags=re.I))
    header = rows[h]
    cols, skipped_cols = {}, []
    for j, lab in enumerate(header[1:], start=1):
        zid = zone_id(lab)
        if zid is None:
            if lab.strip():
                skipped_cols.append(lab.strip())
            continue
        if zid in cols.values():
            raise ValueError(f"duplicate zone column {lab!r}")
        cols[j] = zid
    data, skipped_rows, open_rows = {}, [], []
    for r in rows[h + 1:]:
        if not r or not r[0].strip():
            continue
        lab = r[0].strip()
        a = age_of(lab)
        if a is None:
            skipped_rows.append(lab)
            continue
        if not lab.isdigit():
            open_rows.append(lab)
        vals = np.array([count(r[j]) if j < len(r) else 0.0 for j in cols])
        data[a] = data.get(a, 0) + vals
    seed = pd.DataFrame(data, index=list(cols.values())).sort_index()
    seed = seed.reindex(columns=sorted(seed.columns))
    info = dict(header_row=h, skipped_cols=skipped_cols, skipped_rows=skipped_rows, open_rows=open_rows,
                ages_present=len(data), max_age=max(data))
    return seed, info


def load_circ(path: Path) -> tuple[pd.DataFrame, pd.Series | None]:
    """2025 age x Circoscrizione (index=age, columns=1..8) + the residenza_virtuale age profile
    (never used as a margin; only used to clean the 2020 zone 01 seed)."""
    df = read_csv_it(path, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    acol = next(c for c in df.columns if c.startswith("eta"))
    df["age"] = df[acol].map(age_of)
    df = df[df["age"].notna()]
    circ_cols = {int(re.search(r"\d+", c).group()): c for c in df.columns if re.fullmatch(r"circ_?\d+", c)}
    out = pd.DataFrame({k: to_num(df[c]).fillna(0).to_numpy() for k, c in sorted(circ_cols.items())},
                       index=df["age"].astype(int).to_numpy())
    out = out.groupby(level=0).sum()
    virtual = None
    if "residenza_virtuale" in df:
        virtual = pd.Series(to_num(df["residenza_virtuale"]).fillna(0).to_numpy(),
                            index=df["age"].astype(int).to_numpy()).groupby(level=0).sum()
    return out, virtual


def load_published(path: Path) -> dict[int, float]:
    """Indice di vecchiaia per Circoscrizione from indicatori-demografici-2025."""
    df = read_csv_it(path, dtype=str)
    df.columns = [c.strip().lower() for c in df.columns]
    first = df.columns[0]
    row = df[df[first].str.strip().str.lower().str.startswith("indice di vecchiaia")]
    if row.empty:
        return {}
    return {int(re.search(r"\d+", c).group()): float(to_num(row[c]).iloc[0])
            for c in df.columns if re.fullmatch(r"circ_?\d+", c)}


def virtual_fix(seed: pd.DataFrame, pop_2025: pd.Series, virtual: pd.Series | None):
    """Remove the inferred residenza virtuale from the 2020 zone 01 seed (see module docstring)."""
    if not VIRTUAL_FIX or virtual is None or virtual.sum() <= 0:
        return seed, None
    s = seed.loc[VIRTUAL_ZONE].copy()
    excess = float(s.sum() - pop_2025.loc[VIRTUAL_ZONE])
    if excess <= 0:
        return seed, None
    prof = virtual.reindex(seed.columns, fill_value=0.0) / virtual.sum()
    remove = np.minimum(s, prof * excess)
    seed = seed.copy()
    seed.loc[VIRTUAL_ZONE] = s - remove
    info = dict(zone=VIRTUAL_ZONE, raw_total=float(s.sum()), pop_2025=float(pop_2025.loc[VIRTUAL_ZONE]),
                excess=excess, removed=float(remove.sum()), removed_65p=float(remove.loc[65:].sum()),
                raw_65p=float(s.loc[65:].sum()), virtual_2025=float(virtual.sum()),
                ratio_pop2025_seed=float(pop_2025.loc[VIRTUAL_ZONE] / s.sum()))
    return seed, info


# ---------------------------------------------------------------- fitting
def ipf(S: np.ndarray, row_t: np.ndarray, col_t: np.ndarray):
    X = S.copy()
    err = np.inf
    for it in range(1, MAX_ITER + 1):
        rs = X.sum(1)
        X *= np.divide(row_t, rs, out=np.zeros_like(rs), where=rs > 0)[:, None]
        cs = X.sum(0)
        X *= np.divide(col_t, cs, out=np.zeros_like(cs), where=cs > 0)[None, :]
        err = max(np.abs(X.sum(1) - row_t).max(), np.abs(X.sum(0) - col_t).max())
        if err < TOL:
            return X, it, err
    return None, MAX_ITER, err


def fit_block(S: np.ndarray, row_t: np.ndarray, col_t: np.ndarray):
    S = S.astype(float).copy()
    rows_on, cols_on = row_t > 0, col_t > 0
    # Pass 1: epsilon only where a margin has no seed mass at all.
    need_col = cols_on & (S[rows_on].sum(0) == 0)
    need_row = rows_on & (S[:, cols_on].sum(1) == 0)
    n_eps = 0
    for mr, mc in ((rows_on, need_col), (need_row, cols_on)):
        blk = np.ix_(mr, mc)
        zero = S[blk] == 0
        n_eps += int(zero.sum())
        S[blk] = np.where(zero, EPS, S[blk])
    eps_mode = "margin_cols_rows" if n_eps else "none"
    X, it, err = ipf(S, row_t, col_t)
    if X is None:
        # Pass 2: epsilon in every empty cell of the active block (always feasible).
        blk = np.ix_(rows_on, cols_on)
        zero = S[blk] == 0
        n_eps += int(zero.sum())
        S[blk] = np.where(zero, EPS, S[blk])
        eps_mode = "all_empty_cells"
        X, it2, err = ipf(S, row_t, col_t)
        it += it2
    return X, dict(ipf_iterations=it, ipf_max_err=round(float(err), 4), ipf_converged=X is not None,
                   eps_cells=n_eps, eps_mode=eps_mode)


def scaled_shares(S: np.ndarray, row_t: np.ndarray, col_t: np.ndarray) -> np.ndarray:
    """Fallback: 2020 age shares x pop_2025 (Circoscrizione 2025 profile if a zone had no 2020 seed)."""
    rs = S.sum(1, keepdims=True)
    prof = np.where(rs > 0, S / np.where(rs > 0, rs, 1), col_t / col_t.sum())
    return prof * row_t[:, None]


def round_rows(B: pd.DataFrame, totals: pd.Series) -> pd.DataFrame:
    """Largest-remainder rounding per row so each row adds up to its integer total."""
    V = B.to_numpy()
    F = np.floor(V)
    short = np.rint(totals.to_numpy() - F.sum(1)).astype(int)
    order = np.argsort(-(V - F), axis=1, kind="stable")
    for i, s in enumerate(short):
        F[i, order[i, :max(s, 0)]] += 1
    return pd.DataFrame(F.astype(int), index=B.index, columns=B.columns)


def ageing_index(over65, under15):
    return np.where(np.asarray(under15) > 0, 100 * np.asarray(over65, float) / np.asarray(under15, float), np.nan)


# ---------------------------------------------------------------- main
def main():
    if hasattr(sys.stdout, "reconfigure"):  # Windows console code pages cannot print zone names
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    zones = pd.read_csv(WORK / "zones_base.csv", dtype={"code": str}).sort_values("id")
    seed, sinfo = load_seed(fetch(DS_SEED, "zone_age_2020.csv"))
    circ_age, virtual_2025 = load_circ(fetch(DS_CIRC, "circ_age_2025.csv"))

    missing = set(zones.id) ^ set(seed.index)
    if missing:
        raise ValueError(f"seed zones do not match zones_base ids: {sorted(missing)}")
    max_age = int(max(seed.columns.max(), circ_age.index.max()))
    ages = np.arange(0, max_age + 1)
    seed = seed.reindex(index=zones.id.to_numpy(), columns=ages, fill_value=0.0).fillna(0.0)
    circ_age = circ_age.reindex(ages, fill_value=0.0)

    zi = zones.set_index("id")
    seed_raw = seed.copy()
    seed, vfix = virtual_fix(seed, zi["pop_2025"], virtual_2025)
    est = pd.DataFrame(0.0, index=zones.id.to_numpy(), columns=ages)
    method = pd.Series("ipf", index=zones.id.to_numpy())
    diag = []
    for k in sorted(zones.circ.unique()):
        ids = zones.loc[zones.circ == k, "id"].to_numpy()
        row_t = zi.loc[ids, "pop_2025"].to_numpy(float)
        c_raw = circ_age[k].to_numpy(float)
        col_t = c_raw * row_t.sum() / c_raw.sum()
        S = seed.loc[ids].to_numpy(float)
        X, info = fit_block(S, row_t, col_t)
        m = "ipf"
        if X is None:
            X, m = scaled_shares(S, row_t, col_t), "scaled_2020_shares"
            method[ids] = m
        est.loc[ids] = X
        diag.append(dict(circ=int(k), n_zones=len(ids), pop_circfile_2025=int(c_raw.sum()),
                         pop_zones_assigned_2025=int(row_t.sum()), pop_diff_raw=int(c_raw.sum() - row_t.sum()),
                         method=m, **info))
    diag = pd.DataFrame(diag).set_index("circ")

    # Remove the < TOL residual on rows, then band and round (largest remainder, rows add up exactly).
    pop = zi.loc[est.index, "pop_2025"].astype(float)
    raw_row_err = float((est.sum(1) - pop).abs().max())
    rs = est.sum(1)
    est = est.mul(np.where(rs > 0, pop / rs.where(rs > 0, 1), 0.0), axis=0)
    B = pd.DataFrame({n: est.loc[:, lo:min(hi, max_age)].sum(1) for n, lo, hi in BANDS})
    R = round_rows(B, pop)
    round_row_diff = int((R.sum(1) - pop).abs().max())
    over65_unrounded = B.b65_74 + B.b75p

    out = pd.DataFrame({
        "id": est.index,
        "pop_2025": pop.astype(int).to_numpy(),
        "under15_est": R.b0_14.to_numpy(),
        "over65_est": (R.b65_74 + R.b75p).to_numpy(),
        "over75_est": R.b75p.to_numpy(),
        "adults_50_64_est": R.b50_64.to_numpy(),
        "over75_2030": np.rint(seed.loc[:, 65:].sum(1)).astype(int).to_numpy(),
        "seed_pop_2020": np.rint(seed.sum(1)).astype(int).to_numpy(),
        "method": method.to_numpy(),
    })
    o75 = out.over75_est.where(out.over75_est > 0)
    out["over75_growth"] = (out.over75_2030 / o75).round(3)
    out["seed_note"] = ""
    if vfix:
        out.loc[out.id == vfix["zone"], "seed_note"] = (
            f"2020 raw total {vfix['raw_total']:.0f} incl. inferred residenza virtuale; removed "
            f"{vfix['removed']:.0f} (65+: {vfix['removed_65p']:.0f}) with 2025 virtual age profile")
    out.to_csv(WORK / "age.csv", index=False)

    # ---------------- Circoscrizione check
    zc = out.merge(zones[["id", "circ"]], on="id")
    g = zc.groupby("circ")[["over65_est", "under15_est"]].sum()
    pub_file, pub_err = {}, None
    try:
        pub_file = load_published(fetch(DS_IND, "indicatori_demografici_2025.csv"))
    except Exception as e:  # noqa: BLE001
        pub_err = repr(e)
    chk = pd.DataFrame({"circ": g.index.astype(int)})
    chk["over65_est_sum"] = g.over65_est.to_numpy()
    chk["under15_est_sum"] = g.under15_est.to_numpy()
    ai_est = ageing_index(chk.over65_est_sum, chk.under15_est_sum)
    chk["ageing_index_est"] = ai_est.round(2)
    chk["ageing_index_published"] = chk.circ.map(PUBLISHED_AI)
    chk["diff"] = (ai_est - chk.ageing_index_published).round(2)
    cf65 = circ_age.loc[65:].sum()
    cf15 = circ_age.loc[:14].sum()
    ai_cf = chk.circ.map(pd.Series(ageing_index(cf65, cf15), index=cf65.index))
    chk["ageing_index_circfile"] = ai_cf.round(2)
    chk["diff_circfile"] = (ai_cf - chk.ageing_index_published).round(2)
    # Independent of the 2025 margins: 2020 seed summed over the zones assigned to each circ.
    sg = seed.groupby(zi.loc[seed.index, "circ"].to_numpy()).sum()
    s65, s15 = sg.loc[:, 65:].sum(1), sg.loc[:, :14].sum(1)
    chk["ageing_index_seed2020"] = chk.circ.map(pd.Series(ageing_index(s65, s15), index=sg.index)).round(2)
    chk["ageing_index_published_file"] = chk.circ.map(pub_file) if pub_file else np.nan
    chk["published_confirmed"] = (chk.ageing_index_published_file - chk.ageing_index_published).abs() < 0.05
    for c in ["n_zones", "pop_circfile_2025", "pop_zones_assigned_2025", "pop_diff_raw", "method",
              "ipf_iterations", "ipf_max_err", "eps_cells", "eps_mode"]:
        chk[c] = chk.circ.map(diag[c])
    chk.to_csv(WORK / "age_circ_check.csv", index=False)

    # ---------------- summary
    print("age.py: 2025 zone age ESTIMATES (IPF on 2020 zone x age seed, 2025 Circoscrizione age margins)")
    print(f"seed 2020: {seed.shape[0]} zones x ages 0..{sinfo['max_age']} ({sinfo['ages_present']} age rows; "
          f"missing single years = 0), header row {sinfo['header_row']}, skipped cols {sinfo['skipped_cols']}, "
          f"skipped rows {sinfo['skipped_rows']}, open-ended rows {sinfo['open_rows']}")
    print(f"seed 2020 total: {int(seed.to_numpy().sum())}   pop_2025 total: {int(pop.sum())}   "
          f"circ file 2025 total (circ_1..8): {int(circ_age.to_numpy().sum())}   "
          f"residenza_virtuale ignored: {virtual_2025.sum() if virtual_2025 is not None else float('nan'):.0f}")
    if vfix:
        print(f"zone {vfix['zone']} seed fix: raw 2020 {vfix['raw_total']:.0f}, pop_2025 {vfix['pop_2025']:.0f} "
              f"(ratio {vfix['ratio_pop2025_seed']:.3f}; virtual residents 2025: {vfix['virtual_2025']:.0f}); removed "
              f"{vfix['removed']:.1f} people with the 2025 virtual age profile, of whom 65+ {vfix['removed_65p']:.1f} "
              f"(raw 65+ {vfix['raw_65p']:.0f})")
    else:
        print("zone 01 seed fix: off")
    print("\nper Circoscrizione fit:")
    print(diag.to_string())
    print(f"\nmethods: {out.method.value_counts().to_dict()}")
    print(f"max |IPF row sum - pop_2025| before rounding: {raw_row_err:.4f}")
    print(f"max |sum of rounded disjoint bands - pop_2025|: {round_row_diff}")
    print(f"max |over65_est - unrounded over65|: {float((out.over65_est - over65_unrounded.to_numpy()).abs().max()):.3f}")
    tot = out[["under15_est", "adults_50_64_est", "over65_est", "over75_est", "over75_2030"]].sum()
    print("city totals:", tot.to_dict())
    cf_tot = circ_age.to_numpy().sum()
    print(f"circ file shares 2025: under15 {circ_age.loc[:14].to_numpy().sum() / cf_tot:.4f}  "
          f"over65 {cf65.sum() / cf_tot:.4f}  over75 {circ_age.loc[75:].to_numpy().sum() / cf_tot:.4f}  | "
          f"estimate shares: under15 {tot.under15_est / pop.sum():.4f}  over65 {tot.over65_est / pop.sum():.4f}  "
          f"over75 {tot.over75_est / pop.sum():.4f}")

    print("\nCircoscrizione ageing index check (100 * 65+ / 0-14):")
    print(chk[["circ", "over65_est_sum", "under15_est_sum", "ageing_index_est", "ageing_index_published", "diff",
               "ageing_index_circfile", "diff_circfile", "ageing_index_published_file", "ageing_index_seed2020",
               "pop_diff_raw"]].to_string(index=False))
    if pub_err:
        print(f"published file not read ({pub_err}); using the given published values")

    print("\nhand check (estimates; seed shares are 2020, est shares are 2025):")
    hc = out[out.id.isin(HAND_CHECK)].merge(zones[["id", "name", "circ"]], on="id")
    hc["seed_raw_2020"] = np.rint(seed_raw.loc[hc.id].sum(1)).astype(int).to_numpy()
    s65_2020 = seed.loc[hc.id, 65:].sum(1).to_numpy() / seed.loc[hc.id].sum(1).to_numpy()
    s75_2020 = seed.loc[hc.id, 75:].sum(1).to_numpy() / seed.loc[hc.id].sum(1).to_numpy()
    hc["o65_sh_2020"] = s65_2020.round(3)
    hc["o65_sh_est"] = (hc.over65_est / hc.pop_2025).round(3)
    hc["o75_sh_2020"] = s75_2020.round(3)
    hc["o75_sh_est"] = (hc.over75_est / hc.pop_2025).round(3)
    hc["name"] = hc.name.str.slice(0, 28)
    print(hc[["id", "name", "circ", "seed_raw_2020", "seed_pop_2020", "pop_2025", "under15_est", "adults_50_64_est", "over65_est",
              "over75_est", "over75_2030", "over75_growth", "o65_sh_2020", "o65_sh_est", "o75_sh_2020",
              "o75_sh_est"]].to_string(index=False))
    g75 = out.over75_growth
    print(f"\nover75_growth: median {g75.median():.3f}, min {g75.min():.3f} (id {out.id[g75.idxmin()]}), "
          f"max {g75.max():.3f} (id {out.id[g75.idxmax()]})")
    print(f"\nwrote {WORK / 'age.csv'} ({len(out)} rows) and {WORK / 'age_circ_check.csv'}")
    print("sources:")
    for ds in (DS_SEED, DS_CIRC, DS_IND):
        print(f"  {ds}: {source_url(ds)}")


if __name__ == "__main__":
    main()
