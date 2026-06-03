"""Refresh the Claude outage dataset: fetch -> normalize -> load.

    uv run python -m outage_data.cli

Writes data/claude_outages.duckdb (+ .parquet). Set MOTHERDUCK_TOKEN to also
push to MotherDuck (database from MOTHERDUCK_DATABASE, default "claude_outages").
"""

from __future__ import annotations

import os
from pathlib import Path

from .fetch import fetch_history
from .load import upload_to_motherduck, write_duckdb
from .normalize import normalize_history

DB_PATH = Path("data/claude_outages.duckdb")


def summarize(incidents) -> None:
    outages = [i for i in incidents if i.is_outage]
    total_min = sum(i.duration_minutes for i in outages)
    worst = max(outages, key=lambda i: i.duration_minutes)
    span = (min(i.started_at for i in incidents),
            max(i.ended_at for i in incidents))
    print(f"  incidents:     {len(incidents)} ({len(outages)} outages)")
    print(f"  span:          {span[0].date()} -> {span[1].date()}")
    print(f"  total outage:  {total_min / 60:.1f} hours")
    by_impact: dict[str, int] = {}
    for i in incidents:
        by_impact[i.impact] = by_impact.get(i.impact, 0) + 1
    print(f"  by impact:     {by_impact}")
    print(f"  longest:       {worst.duration_minutes / 60:.1f}h  {worst.name!r}")


def main() -> None:
    print("Fetching Claude incident history...")
    raw = fetch_history()
    incidents = normalize_history(raw)
    summarize(incidents)

    write_duckdb(incidents, DB_PATH)
    print(f"Wrote {DB_PATH} (+ .parquet)")

    token = os.environ.get("MOTHERDUCK_TOKEN")
    if token:
        db = os.environ.get("MOTHERDUCK_DATABASE", "claude_outages")
        upload_to_motherduck(incidents, db, token)
        print(f"Pushed {len(incidents)} incidents to MotherDuck db '{db}'")
    else:
        print("MOTHERDUCK_TOKEN not set -- skipped MotherDuck upload.")


if __name__ == "__main__":
    main()
