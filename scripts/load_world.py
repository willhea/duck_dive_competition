"""Load world country geometry + a representative UTC offset into MotherDuck.

Feeds the Dive's World-map tab (`world_countries`). Each country gets a single
integer UTC offset, derived from its centroid longitude, then corrected for the
big multi-timezone countries where a geographic centroid is misleading (the US
centroid lands in the Mountain zone, not where most people are).

Run:  MOTHERDUCK_TOKEN=<token> uv run --with pytz python scripts/load_world.py
"""

from __future__ import annotations

import json
import os
import urllib.request

import duckdb

GEOJSON_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"

# Population-weighted offsets for countries whose centroid misrepresents where
# most people (and thus most Claude users) actually are.
OFFSET_OVERRIDES = {
    "United States of America": -5,  # Eastern, not Mountain centroid
    "Canada": -5,                    # Toronto/Montreal
    "Russia": 3,                     # Moscow / European Russia
    "Brazil": -3,                    # Atlantic coast
    "Australia": 10,                 # Sydney/Melbourne
    "China": 8,                      # official single zone, Beijing
    "Mexico": -6,                    # Mexico City
    "Indonesia": 7,                  # Jakarta
    "Kazakhstan": 5,
    "Argentina": -3,
    "Mongolia": 8,
    "Greenland": -3,
    "Dem. Rep. Korea": 9,
}


def centroid_offset(geometry: dict) -> int:
    def coords(geom):
        t = geom["type"]
        if t == "Polygon":
            for ring in geom["coordinates"]:
                yield from ring
        elif t == "MultiPolygon":
            for poly in geom["coordinates"]:
                for ring in poly:
                    yield from ring

    xs = [pt[0] for pt in coords(geometry)]
    lon = sum(xs) / len(xs)
    return max(-11, min(12, round(lon / 15)))


def main() -> None:
    token = os.environ["MOTHERDUCK_TOKEN"]
    gj = json.load(urllib.request.urlopen(
        urllib.request.Request(GEOJSON_URL, headers={"User-Agent": "Mozilla/5.0"}), timeout=40))

    rows, overridden = [], 0
    for f in gj["features"]:
        name = f.get("properties", {}).get("name") or f.get("id") or "?"
        try:
            off = centroid_offset(f["geometry"])
        except (KeyError, ZeroDivisionError):
            continue
        if name in OFFSET_OVERRIDES:
            off = OFFSET_OVERRIDES[name]
            overridden += 1
        rows.append((name, int(off), json.dumps(f["geometry"])))

    con = duckdb.connect(f"md:?motherduck_token={token}")
    con.execute("USE my_db")
    con.execute("CREATE OR REPLACE TABLE world_countries (name VARCHAR, off INTEGER, geom VARCHAR)")
    con.executemany("INSERT INTO world_countries VALUES (?,?,?)", rows)
    n = con.execute("SELECT count(*) FROM world_countries").fetchone()[0]
    print(f"loaded {n} countries ({overridden} offset overrides applied)")
    for nm in ["United States of America", "Russia", "China", "Australia", "Brazil"]:
        r = con.execute("SELECT name, off FROM world_countries WHERE name = ?", [nm]).fetchone()
        print("  ", r)
    con.close()


if __name__ == "__main__":
    main()
