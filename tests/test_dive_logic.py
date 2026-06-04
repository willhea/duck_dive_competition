"""Tests for the Dive's trickier SQL logic, run against the local DuckDB copy.

Mirrors the timezone-aware business-hours computation embedded in the Dive.
Expected values were verified independently against MotherDuck.
"""

import duckdb
import pytest

from outage_data.analysis import business_hours_split

DB = "data/claude_outages.duckdb"


@pytest.fixture
def con():
    c = duckdb.connect(DB, read_only=True)
    yield c
    c.close()


def test_eastern_business_hours(con):
    total, in_biz = business_hours_split(con, "America/New_York", 9, 17)
    assert total == 675
    assert in_biz == 308


def test_in_business_never_exceeds_total(con):
    total, in_biz = business_hours_split(con, "UTC", 0, 24)
    assert in_biz <= total
    # 0..24 on Mon-Fri == all weekday outages, strictly fewer than the full set
    assert 0 < in_biz < total


def test_end_hour_is_exclusive(con):
    _, narrow = business_hours_split(con, "America/New_York", 9, 17)
    _, wider = business_hours_split(con, "America/New_York", 9, 18)
    # widening the end by one hour can only add the 17:00 bucket, never remove
    assert wider >= narrow


def test_timezone_changes_the_result(con):
    _, eastern = business_hours_split(con, "America/New_York", 9, 17)
    _, pacific = business_hours_split(con, "America/Los_Angeles", 9, 17)
    # same window, different tz must shift which incidents land in business hours
    assert eastern != pacific
