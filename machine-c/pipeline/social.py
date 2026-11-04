"""Households and inclusion workstream: people living alone (by Circoscrizione) and foreign residents (by zone).

Writes:
  work/social_circ.csv  circ, people_living_alone, households_total, one_person_households, pop_circ_2025,
                        alone_rate_circ, alone_hh_share
  work/social.csv       id, circ, alone_rate_circ, foreign_2025, foreign_share, foreign_source_level

Sources (AperTO, Comune di Torino, 2025):
  famiglie-per-tipologia-e-circoscrizione-2025          households by type x circ_1..circ_8 + residenza_virtuale
  popolazione-residente-per-eta-e-circoscrizione-2025   residents by single year of age x circ_1..circ_8 + residenza_virtuale
  stranieri-residenti-per-zona-statistica-2025          foreign residents (femmine, maschi) by zone; code 0 = residenza virtuale
  stranieri-residenti-per-sesso-e-circoscrizione-2025   foreign residents by circ: used only to check the zone total

Calculations:
  people_living_alone = one_person_households = "Femmine sole" + "Maschi soli"
  households_total    = sum of all household-type rows (the file has no total row)
  pop_circ_2025       = sum over all ages of the circ file (same geography as the households file)
  alone_rate_circ     = people_living_alone / pop_circ_2025
  alone_hh_share      = one_person_households / households_total
  foreign_2025        = femmine + maschi of the zone
  foreign_share       = foreign_2025 / pop_2025 (pop_2025 from work/zones_base.csv)
The residenza_virtuale column/row (code 0) is kept out of every rate and reported separately.

Run: python social.py
"""
import difflib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pandas as pd

from common import WORK, ckan_resources, download, read_csv_it, to_num

SUB = "social"
DS_FAM = "famiglie-per-tipologia-e-circoscrizione-2025"
DS_POP = "popolazione-residente-per-eta-e-circoscrizione-2025"
DS_FOR = "stranieri-residenti-per-zona-statistica-2025"
DS_FOR_CIRC = "stranieri-residenti-per-sesso-e-circoscrizione-2025"  # independent total, used for checks only
CIRCS = [f"circ_{i}" for i in range(1, 9)]
VIRT = "residenza_virtuale"
BIS = {"09bis": 93, "17bis": 94}
HAND_CHECK_ZONES = [1, 38, 94]  # a central zone, the largest foreign count, a "bis" code


def fetch(name: str) -> tuple[Path, str]:
    """Download the CSV resource of an AperTO dataset into raw/social/<name>.csv. Returns (path, url)."""
    res = ckan_resources(name)
    csv = [r for r in res if r["format"] == "csv"] or res
    url = csv[0]["url"]
    return download(url, f"{name}.csv", sub=SUB), url


def code_to_id(code) -> int:
    """Zone code text -> zone id. '1', '01' -> 1; '09bis', '9 bis' -> 93; '17bis' -> 94; '0' -> 0 (virtual)."""
    s = str(code).strip().lower().replace(" ", "")
    if s.endswith("bis"):
        return BIS[f"{int(s[:-3]):02d}bis"]
    return int(s)


def raw_lines(path: Path) -> list[str]:
    return path.read_bytes().decode("utf-8", errors="replace").splitlines()


def drop_total_rows(df: pd.DataFrame, label: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split off any 'Totale' row so it is not double counted. Returns (body, totals)."""
    is_tot = df[label].astype(str).str.strip().str.lower().str.startswith("tot")
    return df[~is_tot].copy(), df[is_tot].copy()


def households(path: Path) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    fam = read_csv_it(path, sep=";", dtype={"tipologia_famiglia": str})
    fam["tipologia_famiglia"] = fam["tipologia_famiglia"].str.strip()
    for c in CIRCS + [VIRT]:
        fam[c] = to_num(fam[c])
    fam, tot = drop_total_rows(fam, "tipologia_famiglia")
    assert fam[CIRCS + [VIRT]].notna().all().all(), "blank cells in households file"
    fam = fam.set_index("tipologia_famiglia")
    for need in ("Femmine sole", "Maschi soli"):
        assert need in fam.index, f"row {need!r} missing in households file"
    if len(tot):  # if a published total exists, it must equal the sum of the types
        assert (tot[CIRCS].sum().values == fam[CIRCS].sum().values).all(), "households total row mismatch"
    alone = fam.loc["Femmine sole", CIRCS] + fam.loc["Maschi soli", CIRCS]
    out = pd.DataFrame({
        "circ": range(1, 9),
        "people_living_alone": alone.values.astype(int),
        "households_total": fam[CIRCS].sum().values.astype(int),
        "one_person_households": alone.values.astype(int),
    })
    virt = fam[VIRT]
    return out, virt, fam


def population_circ(path: Path) -> tuple[pd.Series, int]:
    pop = read_csv_it(path, sep=";", dtype={"eta_annuale": str})
    for c in CIRCS + [VIRT]:
        pop[c] = to_num(pop[c])
    pop, tot = drop_total_rows(pop, "eta_annuale")
    assert to_num(pop["eta_annuale"]).notna().all(), "non-numeric age label in circ population file"
    totals = pop[CIRCS].sum().astype(int)
    if len(tot):
        assert (tot[CIRCS].sum().values == totals.values).all(), "population total row mismatch"
    return totals, int(pop[VIRT].sum())


def foreign_zones(path: Path) -> pd.DataFrame:
    f = read_csv_it(path, sep=";", dtype={"num_zona_stat": str, "desc_zona_stat": str})
    f.columns = [c.strip().lower() for c in f.columns]
    f, tot = drop_total_rows(f, "num_zona_stat")
    assert len(tot) == 0, "unexpected total row in foreign file"
    f["code_raw"] = f["num_zona_stat"].str.strip()
    f["id"] = f["code_raw"].map(code_to_id)
    f["femmine"] = to_num(f["femmine"]).astype(int)
    f["maschi"] = to_num(f["maschi"]).astype(int)
    f["foreign_2025"] = f["femmine"] + f["maschi"]
    assert f["id"].is_unique, "duplicate zone codes in foreign file"
    return f


def foreign_circ(path: Path) -> tuple[pd.Series, int]:
    """Foreign residents by circ (check file). Columns by position: circ, femmine, maschi, total (unnamed)."""
    f = read_csv_it(path, sep=";", dtype=str)
    f = f.iloc[:, :4]
    f.columns = ["circ", "femmine", "maschi", "totale"]
    f["circ"] = f["circ"].str.strip()
    for c in ("femmine", "maschi", "totale"):
        f[c] = to_num(f[c])
    assert (f["femmine"] + f["maschi"] == f["totale"]).all(), "circ foreign file: F + M != total"
    is_virt = f["circ"].str.lower().str.contains("virtual")
    body = f[~is_virt].copy()
    body["circ"] = body["circ"].astype(int)
    return body.set_index("circ")["totale"].astype(int), int(f.loc[is_virt, "totale"].sum())


def name_similarity(a: str, b: str) -> float:
    norm = lambda s: " ".join(str(s).lower().replace("'", " ").split())
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def main():
    z = pd.read_csv(WORK / "zones_base.csv", dtype={"code": str})
    assert len(z) == 94 and z["id"].is_unique

    p_fam, u_fam = fetch(DS_FAM)
    p_pop, u_pop = fetch(DS_POP)
    p_for, u_for = fetch(DS_FOR)
    p_forc, u_forc = fetch(DS_FOR_CIRC)

    # ---------- 1. Circoscrizione table: people living alone ----------
    circ, hh_virt, fam = households(p_fam)
    pop_circ, pop_virt = population_circ(p_pop)
    circ["pop_circ_2025"] = pop_circ.values
    circ["alone_rate_circ"] = (circ["people_living_alone"] / circ["pop_circ_2025"]).round(4)
    circ["alone_hh_share"] = (circ["one_person_households"] / circ["households_total"]).round(4)
    circ.to_csv(WORK / "social_circ.csv", index=False)

    print("=== work/social_circ.csv (residenza virtuale excluded) ===")
    print(circ.to_string(index=False))
    alone_city = int(circ["people_living_alone"].sum())
    pop_city = int(circ["pop_circ_2025"].sum())
    hh_city = int(circ["households_total"].sum())
    print(f"Torino, circ 1-8: people living alone {alone_city:,} / residents {pop_city:,} = "
          f"{alone_city / pop_city:.4f}; one-person households {alone_city:,} / households {hh_city:,} = "
          f"{alone_city / hh_city:.4f}")
    print("Living alone by sex (circ 1-8):", {k: int(fam.loc[k, CIRCS].sum()) for k in ("Femmine sole", "Maschi soli")})
    print(f"Residenza virtuale, reported separately and kept out of the rates: Femmine sole "
          f"{int(hh_virt['Femmine sole'])}, Maschi soli {int(hh_virt['Maschi soli'])}, all households "
          f"{int(hh_virt.sum())}, residents {pop_virt}")

    # Denominator check: circ file vs zone file (same 2025 register, different geography).
    zb_city = int(z["pop_2025"].sum())
    print(f"\nCheck: circ-file residents (circ 1-8) {pop_city:,} vs zones_base pop_2025 total {zb_city:,} "
          f"-> diff {pop_city - zb_city:+,}; circ-file residenza virtuale {pop_virt:,} (brief: 4,375)")
    zsum = z.groupby("circ")["pop_2025"].sum()
    cmp = pd.DataFrame({"pop_circ_2025 (circ file)": pop_circ.values,
                        "sum pop_2025 of zones assigned to circ": zsum.reindex(range(1, 9)).values},
                       index=pd.Index(range(1, 9), name="circ"))
    cmp["diff"] = cmp.iloc[:, 0] - cmp.iloc[:, 1]
    print("Denominator per circ (zones straddling two circ explain the differences; circ file used):")
    print(cmp.to_string())

    # ---------- 2. Zone table: foreign residents ----------
    f = foreign_zones(p_for)
    virt = f[f["id"] == 0]
    fz = f[f["id"] != 0].set_index("id")
    missing = sorted(set(z["id"]) - set(fz.index))
    extra = sorted(set(fz.index) - set(z["id"]))
    assert not missing and not extra, f"zone mismatch: missing {missing}, extra {extra}"

    out = z[["id", "circ", "pop_2025", "female_2025", "male_2025", "name"]].copy()
    out["alone_rate_circ"] = out["circ"].map(circ.set_index("circ")["alone_rate_circ"])
    out["foreign_2025"] = out["id"].map(fz["foreign_2025"]).astype(int)
    out["foreign_share"] = (out["foreign_2025"] / out["pop_2025"]).round(4)
    out["foreign_source_level"] = "zona"

    # Consistency: foreign residents cannot exceed residents (total and by sex) in a zone.
    bad = out[(out["foreign_2025"] > out["pop_2025"])
              | (out["id"].map(fz["femmine"]) > out["female_2025"])
              | (out["id"].map(fz["maschi"]) > out["male_2025"])]
    assert bad.empty, f"foreign > residents in zones:\n{bad}"
    # Names: the foreign file must describe the same zone as zones_base for each id.
    out["src_name"] = out["id"].map(fz["desc_zona_stat"])
    out["name_sim"] = [name_similarity(a, b) for a, b in zip(out["name"], out["src_name"])]
    weak = out[out["name_sim"] < 0.85][["id", "name", "src_name", "name_sim"]]

    cols = ["id", "circ", "alone_rate_circ", "foreign_2025", "foreign_share", "foreign_source_level"]
    out = out.sort_values("id")
    out[cols].to_csv(WORK / "social.csv", index=False)

    # ---------- 3. Checks ----------
    f_zones = int(out["foreign_2025"].sum())
    f_virt = int(virt["foreign_2025"].sum())
    f_file = int(f["foreign_2025"].sum())
    print(f"\n=== work/social.csv: {len(out)} zones ===")
    print(f"Foreign residents: zones sum {f_zones:,} + residenza virtuale {f_virt:,} "
          f"(F {int(virt['femmine'].sum())}, M {int(virt['maschi'].sum())}) = {f_zones + f_virt:,}; "
          f"file total (all rows, no published total row) {f_file:,} -> "
          f"{'OK' if f_zones + f_virt == f_file else 'MISMATCH'}")
    fc, fc_virt = foreign_circ(p_forc)
    print(f"Independent check vs {DS_FOR_CIRC}: circ 1-8 total {int(fc.sum()):,} vs zones sum {f_zones:,} -> "
          f"{'OK' if int(fc.sum()) == f_zones else 'MISMATCH'}; residenza virtuale {fc_virt:,} vs {f_virt:,} -> "
          f"{'OK' if fc_virt == f_virt else 'MISMATCH'}")
    fcmp = pd.DataFrame({"foreign (circ file)": fc,
                         "sum foreign_2025 of zones assigned to circ": out.groupby("circ")["foreign_2025"].sum()})
    fcmp["diff"] = fcmp.iloc[:, 0] - fcmp.iloc[:, 1]
    print("Per circ (differences come from zones straddling two circ):")
    print(fcmp.to_string())
    print(f"Citywide foreign share, zones only: {f_zones:,} / {zb_city:,} = {f_zones / zb_city:.4f}")
    print(f"Name check (id -> zones_base name vs foreign-file name): min similarity {out['name_sim'].min():.2f}; "
          f"pairs below 0.85:")
    print(weak.to_string(index=False) if len(weak) else "  none")
    print("foreign_share summary:", out["foreign_share"].describe().round(4).to_dict())
    print("Top 5 foreign_share:")
    print(out.nlargest(5, "foreign_share")[["id", "name", "pop_2025", "foreign_2025", "foreign_share"]].to_string(index=False))
    print("Zones with pop_2025 < 1000 (shares on small bases):")
    print(out[out["pop_2025"] < 1000][["id", "name", "pop_2025", "foreign_2025", "foreign_share"]].to_string(index=False))

    # Hand check: raw source lines next to computed values.
    print("\n=== Hand check: raw source lines vs output ===")
    for_lines = raw_lines(p_for)
    zb_lines = raw_lines(WORK / "zones_base.csv")
    fam_lines = raw_lines(p_fam)
    for zid in HAND_CHECK_ZONES:
        r = out.set_index("id").loc[zid]
        code = z.set_index("id").loc[zid, "code"]
        src = [ln for ln in for_lines[1:] if code_to_id(ln.split(";")[0].strip('"')) == zid]
        zbl = [ln for ln in zb_lines[1:] if ln.split(",")[0] == str(zid)]
        print(f"zone id {zid} (code {code}):")
        print(f"  foreign file : {src[0] if src else 'NOT FOUND'}")
        print(f"  zones_base   : {zbl[0] if zbl else 'NOT FOUND'}")
        print(f"  output       : foreign_2025={int(r.foreign_2025)}  pop_2025={int(r.pop_2025)}  "
              f"foreign_share={r.foreign_share}  circ={int(r.circ)}  alone_rate_circ={r.alone_rate_circ}")
    hdr = fam_lines[0]
    print("households file header:", hdr)
    for ln in fam_lines[1:]:
        if ln.split(";")[0].strip('"') in ("Femmine sole", "Maschi soli"):
            print("  ", ln)
    print("circ file residents by circ:", dict(zip(CIRCS, pop_circ.tolist())), f"{VIRT}={pop_virt}")

    print("\nSources:")
    for n, u in ((DS_FAM, u_fam), (DS_POP, u_pop), (DS_FOR, u_for), (DS_FOR_CIRC, u_forc)):
        print(f"  {n}: {u}")


if __name__ == "__main__":
    main()
