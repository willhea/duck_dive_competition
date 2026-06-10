"""Normalize Anthropic Statuspage ``history.json`` incidents.

The hard part is the timestamp: ``history.json`` renders it as a display string
like ``"Jun 3, 07:10 - 07:38 UTC"`` (same-day) or
``"May 30, 22:58 - May 31, 00:16 UTC"`` (multi-day), with the *year* supplied
separately by the enclosing month. We parse it back into real UTC datetimes.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .model import Incident

PROVIDER = "Anthropic"
INCIDENT_URL = "https://status.claude.com/incidents/{code}"

_VAR_TAG = re.compile(r"<[^>]+>")
# "Mon D, HH:MM"  e.g. "Jun 3, 07:10"
_DATETIME = re.compile(r"([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})")
_MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def parse_history_timestamp(
    display: str, year: int
) -> tuple[datetime, datetime] | None:
    """Parse a Statuspage history display timestamp into (start, end) UTC datetimes.

    ``display`` may contain ``<var>`` tags (raw API) or be pre-stripped.
    ``year`` is the year of the *start* of the incident; when an incident spans a
    Dec->Jan boundary the end rolls into ``year + 1``.

    Returns ``None`` for an unresolved incident, which Statuspage renders with a
    start but no end (e.g. ``"Jun 10, 13:06 UTC"``). Its true duration is unknown
    until Anthropic closes it, so the caller skips it rather than inventing one.
    """
    text = _VAR_TAG.sub("", display)
    text = text.replace("UTC", "").strip()

    start_part, _, end_part = text.partition(" - ")
    start = _parse_dt(start_part, year)
    end_part = end_part.strip()

    if not end_part:
        return None  # ongoing: start logged, no end yet

    # End is either "HH:MM" (same day) or its own "Mon D, HH:MM".
    if _DATETIME.search(end_part):
        end = _parse_dt(end_part, year)
        # Dec -> Jan rollover: end month earlier than start month means next year.
        if end.month < start.month:
            end = end.replace(year=year + 1)
    elif ":" in end_part:
        hh, mm = end_part.split(":")
        end = start.replace(hour=int(hh), minute=int(mm))
    else:
        return None  # unrecognized end form — skip rather than crash the refresh

    return start, end


def _parse_dt(part: str, year: int) -> datetime:
    m = _DATETIME.search(part)
    if not m:
        raise ValueError(f"unparseable timestamp part: {part!r}")
    mon, day, hour, minute = m.groups()
    return datetime(year, _MONTHS[mon], int(day), int(hour), int(minute),
                    tzinfo=timezone.utc)


def normalize_incident(raw: dict) -> Incident | None:
    """Map one ``history.json`` incident (with ``_year`` attached) to an Incident.

    Returns ``None`` for an unresolved incident (no end time published yet).
    """
    parsed = parse_history_timestamp(raw["timestamp"], raw["_year"])
    if parsed is None:
        return None
    start, end = parsed
    return Incident(
        provider=PROVIDER,
        code=raw["code"],
        name=raw["name"],
        impact=raw["impact"],
        started_at=start,
        ended_at=end,
        duration_minutes=(end - start).total_seconds() / 60,
        url=INCIDENT_URL.format(code=raw["code"]),
    )


def normalize_history(raw_incidents: list[dict]) -> list[Incident]:
    """Map a list of raw history incidents to Incidents, skipping unresolved ones."""
    out = (normalize_incident(raw) for raw in raw_incidents)
    return [inc for inc in out if inc is not None]
