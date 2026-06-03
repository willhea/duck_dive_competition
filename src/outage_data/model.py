from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

# impact values that represent a real service problem (vs. planned/informational)
OUTAGE_IMPACTS = frozenset({"minor", "major", "critical"})


@dataclass(frozen=True)
class Incident:
    """One normalized status-page incident.

    Sourced from Statuspage ``history.json``, where timestamps arrive as a
    rendered display string and the year comes from the enclosing month.
    """

    provider: str
    code: str
    name: str
    impact: str  # minor | major | critical | none | maintenance
    started_at: datetime  # UTC
    ended_at: datetime  # UTC (history incidents are all resolved)
    duration_minutes: float
    url: str

    @property
    def is_outage(self) -> bool:
        return self.impact in OUTAGE_IMPACTS
