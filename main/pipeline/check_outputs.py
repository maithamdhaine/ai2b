"""Check the published outputs: python check_outputs.py  (exit 1 on any failure).

Reads out/*.json|geojson and work/plan_test_vectors.json only; downloads nothing.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT, WORK = HERE / "out", HERE / "work"
fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


zones = load(OUT / "zones.geojson")
services = load(OUT / "services.geojson")
funded = load(OUT / "funded.json")
meta = load(OUT / "meta.json")

# zones
feats = zones["features"]
ids = [f["properties"]["id"] for f in feats]
check(len(feats) == 94 and len(set(ids)) == 94, f"94 unique zone ids (got {len(set(ids))})")
by_id = {f["properties"]["id"]: f["properties"] for f in feats}
check(by_id.get(93, {}).get("code") == "09bis" and by_id.get(94, {}).get("code") == "17bis", "93 = 09bis, 94 = 17bis")
pop = sum(p["pop_2025"] for p in by_id.values())
check(pop == 858874, f"pop_2025 total 858,874 (got {pop:,})")
check(by_id.get(61, {}).get("name") == "Lingotto - Ex Ippodromo" and by_id[61]["pop_2025"] == 25059, "zone 61 Lingotto, pop 25,059")

try:
    from shapely.geometry import shape
    bad = [f["properties"]["id"] for f in feats if not shape(f["geometry"]).is_valid]
    check(not bad, f"all zone geometries valid (invalid: {bad})")
except ImportError:
    print("skip geometry validity (shapely not installed)")


def coords(g):
    if g["type"] == "Point":
        yield g["coordinates"]
    else:
        for part in (g["coordinates"] if g["type"] == "Polygon" else [r for poly in g["coordinates"] for r in poly]):
            yield from part


lon = [c[0] for f in feats for c in coords(f["geometry"])]
lat = [c[1] for f in feats for c in coords(f["geometry"])]
check(7.5 < min(lon) and max(lon) < 7.8 and 44.9 < min(lat) and max(lat) < 45.2, "zone coordinates are WGS84 lon/lat inside Turin")

NULLABLE = {"over75_2030", "stability_top10", "pharmacy_m"}
nulls = {k for p in by_id.values() for k, v in p.items() if v is None}
nulls |= {k for p in by_id.values() for k, v in p["nearest"].items() if v is None}
check(nulls <= NULLABLE, f"only nullable fields are null (null fields: {sorted(nulls)})")
for k in ("isolation", "service_gap", "future_pressure", "inclusion"):
    vals = [p[k] for p in by_id.values() if p.get(k) is not None]
    check(vals and all(0 <= v <= 100 for v in vals), f"{k} in 0..100")
for k in ("alone_rate_circ", "foreign_share", "funded_share"):
    vals = [p[k] for p in by_id.values() if p.get(k) is not None]
    check(vals and all(0 <= v <= 1 for v in vals), f"{k} in 0..1")
st = [p["stability_top10"] for p in by_id.values() if p.get("stability_top10") is not None]
check(all(0 <= v <= 1 for v in st), "stability_top10 in 0..1 where present")
small = [i for i, p in by_id.items() if p["small_zone"]]
check(all(by_id[i]["pop_2025"] < 1000 for i in small), f"small_zone = pop < 1000 ({len(small)} zones)")

# services
sf = services["features"]
kinds = {}
for f in sf:
    kinds[f["properties"]["type"]] = kinds.get(f["properties"]["type"], 0) + 1
print("     services:", len(sf), kinds)
check(all(f["geometry"]["type"] == "Point" for f in sf), "services are points")

# funded
items = funded["items"] if isinstance(funded, dict) else funded
tot = sum(i["amount_eur"] for i in items)
placed = [i for i in items if i.get("zone_id") is not None]
print(f"     funded: {len(items)} rows, EUR {tot:,.0f}, {len(placed)} placed in a zone")
zone_sum = sum(p["funded_eur"] for p in by_id.values())
placed_sum = sum(i["amount_eur"] for i in placed)
check(abs(zone_sum - placed_sum) < 1, f"sum zones.funded_eur = sum placed funded rows ({zone_sum:,.0f})")
check(all(i.get("zone_id") in by_id for i in placed), "funded zone_ids exist")

# meta
check(meta.get("mock") is False, "meta.mock is false")
print("     meta sources:", len(meta.get("sources", [])))

# robustness
rp = OUT / "robustness.json"
if rp.exists():
    rob = load(rp)
    lz = rob["local"]["zones"]
    rz = {int(z["zone_id"]) for z in rob["zones"]}
    rz |= {int(k) for k in lz} if isinstance(lz, dict) else {int(z["zone_id"]) for z in lz}
    check(rz <= set(by_id), "robustness zone ids exist in zones.geojson")
    print("     robustness settings:", {k: rob[k] for k in ("planner", "budget_eur", "n_weightings", "seed")}, "local weights:", rob["local"].get("weights"))

# test vectors
tv = load(WORK / "plan_test_vectors.json")
for name, case in tv["cases"].items():
    zs = sorted({it["zone_id"] for it in case["plan"]})
    check(set(zs) <= set(by_id), f"test vector {name}: zone ids exist")
    spent = sum(it["budget_eur"] for it in case["plan"])
    people = sum(it["people_reached"] for it in case["plan"])
    b = case["input"]["budget"]
    check(spent <= b + 1e-6, f"test vector {name}: spent {spent:,.0f} <= budget {b:,.0f}; zones {zs}; people {people:,}")

print("\nFAILED:", fails if fails else "none")
sys.exit(1 if fails else 0)
