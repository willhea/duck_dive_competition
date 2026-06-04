"""Reusable analytics over the outages table.

These mirror the SQL embedded in the Dive (`.dive-preview/src/dive.tsx`). The Dive
must be a single self-contained file, so it can't import this module — instead this
is the tested, canonical version of the trickier logic (timezone-aware business
hours), and the Dive's inline SQL is kept in sync with it.
"""

from __future__ import annotations

import duckdb


def business_hours_split(
    con: duckdb.DuckDBPyConnection,
    tz: str,
    start_hour: int,
    end_hour: int,
    table: str = "claude_outages",
) -> tuple[int, int]:
    """Return (total_outages, outages_started_in_business_hours).

    Business hours = local start hour in [start_hour, end_hour) on Mon-Fri, where
    "local" is the incident start converted to ``tz`` (DST-correct via ICU).
    """
    con.execute("LOAD icu")
    total, in_biz = con.execute(
        f"""
        WITH local AS (
            SELECT extract('hour' FROM (started_at AT TIME ZONE ?)) AS h,
                   isodow(started_at AT TIME ZONE ?) AS d
            FROM {table} WHERE is_outage
        )
        SELECT count(*),
               count(*) FILTER (WHERE h >= ? AND h < ? AND d <= 5)
        FROM local
        """,
        [tz, tz, start_hour, end_hour],
    ).fetchone()
    return int(total), int(in_biz)
