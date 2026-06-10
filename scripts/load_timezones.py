"""Load real timezone-boundary polygons into MotherDuck for the World-map tab.

Source: Natural Earth 10m time zones (cartographic, follows political timezone
borders over land + nautical 15-deg wedges over ocean). Each feature carries a
UTC offset; we round it to the integer-offset model the Dive colors by
(generate_series(-11, 12)), clamping the few outliers (-12, +13, +14).

The raw file is ~6.6 MB, far too heavy to ship to the browser, so we simplify
the geometry (Douglas-Peucker) and trim coordinate precision before storing.

Run:  MOTHERDUCK_TOKEN=<token> uv run --with shapely python scripts/load_timezones.py
"""

from __future__ import annotations

import json
import math
import os
import urllib.request

import duckdb
from shapely.geometry import mapping, shape

NE_TZ_URL = (
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson"
    "/master/10m/cultural/ne_10m_time_zones.json"
)
SIMPLIFY_TOLERANCE = 0.15  # degrees (~16 km); tuned for size vs. legibility
COORD_DECIMALS = 2         # ~1 km; plenty for a world map


def to_offset(zone: float) -> int:
    """Round a (possibly fractional) UTC offset to the Dive's integer model."""
    return max(-11, min(12, math.floor(zone + 0.5)))


def round_coords(obj):
    """Recursively round coordinate floats to COORD_DECIMALS to shrink payload."""
    if isinstance(obj, float):
        return round(obj, COORD_DECIMALS)
    if isinstance(obj, list):
        return [round_coords(x) for x in obj]
    return obj


def main() -> None:
    token = os.environ["MOTHERDUCK_TOKEN"]
    gj = json.load(urllib.request.urlopen(
        urllib.request.Request(NE_TZ_URL, headers={"User-Agent": "Mozilla/5.0"}),
        timeout=60))

    rows, total_bytes = [], 0
    for f in gj["features"]:
        props = f.get("properties", {})
        zone = props.get("zone")
        if zone is None:
            continue
        off = to_offset(float(zone))
        geom = shape(f["geometry"]).simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
        if geom.is_empty:
            continue
        geom_json = json.dumps(round_coords(mapping(geom)), separators=(",", ":"))
        total_bytes += len(geom_json)
        rows.append((props.get("name", str(off)), off, geom_json))

    print(f"prepared {len(rows)} timezone polygons, "
          f"{total_bytes / 1024 / 1024:.2f} MB total geometry "
          f"(tolerance={SIMPLIFY_TOLERANCE}, decimals={COORD_DECIMALS})")

    con = duckdb.connect(f"md:?motherduck_token={token}")
    con.execute("CREATE DATABASE IF NOT EXISTS claude_outages")
    con.execute("USE claude_outages")
    con.execute("CREATE OR REPLACE TABLE world_timezones (name VARCHAR, off INTEGER, geom VARCHAR)")
    con.executemany("INSERT INTO world_timezones VALUES (?,?,?)", rows)
    n = con.execute("SELECT count(*) FROM world_timezones").fetchone()[0]
    by_off = con.execute(
        "SELECT off, count(*) FROM world_timezones GROUP BY off ORDER BY off").fetchall()
    print(f"loaded {n} timezone polygons; offsets present: {by_off}")
    con.close()


if __name__ == "__main__":
    main()
