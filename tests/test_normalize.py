import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from outage_data.model import Incident
from outage_data.normalize import (
    normalize_history,
    normalize_incident,
    parse_history_timestamp,
)

FIXTURE = Path(__file__).parent / "fixtures" / "anthropic_history.json"


@pytest.fixture
def raw_incidents():
    return json.loads(FIXTURE.read_text())


def utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


# --- timestamp parsing: the core logic ---------------------------------------


def test_parse_same_day():
    start, end = parse_history_timestamp("Jun 3, 07:10 - 07:38 UTC", 2026)
    assert start == utc(2026, 6, 3, 7, 10)
    assert end == utc(2026, 6, 3, 7, 38)


def test_parse_multi_day():
    start, end = parse_history_timestamp("May 30, 22:58 - May 31, 00:16 UTC", 2026)
    assert start == utc(2026, 5, 30, 22, 58)
    assert end == utc(2026, 5, 31, 0, 16)


def test_parse_year_boundary_rolls_into_next_year():
    # incident listed under December 2025 that ends in January
    start, end = parse_history_timestamp("Dec 31, 23:30 - Jan 1, 00:45 UTC", 2025)
    assert start == utc(2025, 12, 31, 23, 30)
    assert end == utc(2026, 1, 1, 0, 45)


def test_parse_strips_var_tags():
    raw = ("Jun 3, <var data-var='time'>07:10</var> - "
           "<var data-var='time'>07:38</var> UTC")
    start, end = parse_history_timestamp(raw, 2026)
    assert start == utc(2026, 6, 3, 7, 10)
    assert end == utc(2026, 6, 3, 7, 38)


# --- unresolved (ongoing) incidents ------------------------------------------


def test_parse_ongoing_incident_returns_none():
    # An unresolved incident is rendered with a start but no end time.
    assert parse_history_timestamp("Jun 10, 13:06 UTC", 2026) is None
    raw = "Jun <var data-var='date'>10</var>, <var data-var='time'>13:06</var> UTC"
    assert parse_history_timestamp(raw, 2026) is None


def test_normalize_history_skips_ongoing(raw_incidents):
    ongoing = {
        "code": "ongoing123", "name": "Still happening", "impact": "minor",
        "timestamp": "Jun 10, 13:06 UTC", "_year": 2026,
    }
    assert normalize_incident(ongoing) is None
    out = normalize_history(raw_incidents + [ongoing])
    assert len(out) == len(raw_incidents)  # the ongoing one is dropped
    assert all(i.code != "ongoing123" for i in out)


# --- incident normalization --------------------------------------------------


def test_normalize_incident_core_fields(raw_incidents):
    major = next(i for i in raw_incidents if i["impact"] == "major")
    inc = normalize_incident(major)
    assert isinstance(inc, Incident)
    assert inc.provider == "Anthropic"
    assert inc.code == major["code"]
    assert inc.impact == "major"
    assert inc.url == f"https://status.claude.com/incidents/{major['code']}"
    assert inc.duration_minutes == pytest.approx(
        (inc.ended_at - inc.started_at).total_seconds() / 60
    )
    assert inc.duration_minutes > 0


def test_is_outage_flag(raw_incidents):
    by_impact = {i["impact"]: normalize_incident(i) for i in raw_incidents}
    assert by_impact["major"].is_outage is True
    assert by_impact["minor"].is_outage is True
    assert by_impact["maintenance"].is_outage is False
    assert by_impact["none"].is_outage is False


def test_normalize_history_maps_all(raw_incidents):
    out = normalize_history(raw_incidents)
    assert len(out) == len(raw_incidents)
    assert all(isinstance(i, Incident) for i in out)
    assert all(i.ended_at >= i.started_at for i in out)
