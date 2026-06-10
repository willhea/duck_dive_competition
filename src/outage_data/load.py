"""Load normalized incidents into DuckDB and export for MotherDuck.

The Dive queries a MotherDuck table; this builds that table locally as DuckDB
(plus a Parquet export) and can push it to MotherDuck when a token is present.
Time parts (hour, weekday, etc.) are intentionally *not* precomputed -- DuckDB
derives them trivially in the Dive's SQL, keeping one source of truth.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from .model import Incident

TABLE = "claude_outages"

_DDL = f"""
CREATE OR REPLACE TABLE {TABLE} (
    provider          VARCHAR,
    code              VARCHAR,
    name              VARCHAR,
    impact            VARCHAR,
    is_outage         BOOLEAN,
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    duration_minutes  DOUBLE,
    url               VARCHAR
);
"""


def _rows(incidents: list[Incident]) -> list[tuple]:
    return [
        (i.provider, i.code, i.name, i.impact, i.is_outage,
         i.started_at, i.ended_at, i.duration_minutes, i.url)
        for i in incidents
    ]


def write_duckdb(incidents: list[Incident], db_path: str | Path) -> Path:
    """Create/replace the outages table in a local DuckDB file."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    try:
        con.execute(_DDL)
        con.executemany(
            f"INSERT INTO {TABLE} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            _rows(incidents),
        )
        con.execute(
            f"COPY {TABLE} TO '{db_path.with_suffix('.parquet')}' (FORMAT parquet)"
        )
    finally:
        con.close()
    return db_path


def upload_to_motherduck(
    incidents: list[Incident], database: str, token: str
) -> None:
    """Push the table to MotherDuck (requires a MotherDuck access token)."""
    con = duckdb.connect(f"md:?motherduck_token={token}")
    try:
        con.execute(f"CREATE DATABASE IF NOT EXISTS {database}")
        con.execute(f"USE {database}")
        con.execute(_DDL)
        con.executemany(
            f"INSERT INTO {TABLE} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            _rows(incidents),
        )
    finally:
        con.close()
