"""Lead: base zone table. Boundaries (WGS84), ids, names, Circoscrizione by largest overlap, pop_2025.

Writes:
  work/zones_base.csv      id, code, name, circ, pop_2025, female_2025, male_2025, area_km2, circ_overlap
  work/zones_base.geojson  same + geometry (WGS84)

Id rule: numeric zone codes keep their number. The two "bis" zones get the next free ids:
  09bis (Parco del Valentino) -> 93, 17bis -> 94. The original code is kept in `code`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geopandas as gpd
import pandas as pd

from common import RAW, WORK, METRIC_CRS, download, unzip, wkt_csv_to_gdf, fetch_dataset, read_csv_it

BIS = {"09bis": 93, "17bis": 94}


def code_to_id(code: str) -> int:
    code = str(code).strip()
    return BIS[code] if code in BIS else int(code)


def main():
    zp = download("http://geoportale.comune.torino.it/geodati/zip/zone_statistiche_csv.zip", sub="geo")
    cp = download("http://geoportale.comune.torino.it/geodati/zip/circoscrizioni_csv.zip", sub="geo")
    zdir, cdir = unzip(zp), unzip(cp)
    z = wkt_csv_to_gdf(zdir / "zone_statistiche.csv")
    c = wkt_csv_to_gdf(cdir / "circoscrizioni.csv")
    z["code"] = z["ZONASTAT"].astype(str).str.strip()
    z["id"] = z["code"].map(code_to_id)
    z["name"] = z["DENOM"].str.strip()
    c["circ"] = c["NCIRCO"].astype(int)

    zm, cm = z.to_crs(METRIC_CRS), c.to_crs(METRIC_CRS)
    z["area_km2"] = (zm.area / 1e6).round(4)
    inter = gpd.overlay(zm[["id", "geometry"]], cm[["circ", "geometry"]], how="intersection", keep_geom_type=True)
    inter["a"] = inter.area
    inter = inter.sort_values("a", ascending=False)
    tot = inter.groupby("id")["a"].sum()
    best = inter.drop_duplicates("id").set_index("id")
    z["circ"] = z["id"].map(best["circ"]).astype(int)
    z["circ_overlap"] = z["id"].map((best["a"] / tot).round(3))

    pp = fetch_dataset("popolazione-per-sesso-e-zona-statistica-2025", pick=lambda r: True)
    pop = read_csv_it(pp, dtype={"Num_zona_stat": str})
    pop["code"] = pop["Num_zona_stat"].str.strip()
    # normalise "1" vs "01"
    pop["code"] = pop["code"].map(lambda s: s if "bis" in s else str(int(s)))
    z["code_n"] = z["code"].map(lambda s: s if "bis" in s else str(int(s)))
    virtual = pop[pop["code"] == "0"]
    pop = pop[pop["code"] != "0"].set_index("code")
    z["female_2025"] = z["code_n"].map(pop["femmine"]).astype(int)
    z["male_2025"] = z["code_n"].map(pop["maschi"]).astype(int)
    z["pop_2025"] = z["female_2025"] + z["male_2025"]
    z["pop_name"] = z["code_n"].map(pop["Desc_zona_stat"])

    assert z["id"].is_unique and len(z) == 94
    assert z["pop_2025"].sum() == int(pop["femmine"].sum() + pop["maschi"].sum()), "zone totals mismatch"

    cols = ["id", "code", "name", "circ", "circ_overlap", "pop_2025", "female_2025", "male_2025", "area_km2"]
    z = z.sort_values("id")
    z[cols].to_csv(WORK / "zones_base.csv", index=False)
    z[cols + ["geometry"]].to_file(WORK / "zones_base.geojson", driver="GeoJSON")
    print(f"zones: {len(z)}  pop_2025 total: {z.pop_2025.sum()}  (virtual residence excluded: "
          f"{int(virtual.femmine.sum() + virtual.maschi.sum())})")
    print(z.groupby("circ")["pop_2025"].sum())
    low = z[z.circ_overlap < 0.9][["id", "name", "circ", "circ_overlap"]]
    if len(low):
        print("zones split across Circoscrizioni (<90% in assigned one):\n", low.to_string(index=False))


if __name__ == "__main__":
    main()
