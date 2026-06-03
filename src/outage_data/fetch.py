"""Fetch deep incident history from a Statuspage ``history.json`` feed.

``history.json?page=N`` returns three months per page and paginates back to the
status page's inception. We walk pages until one comes back with no incidents,
attaching each incident's enclosing year/month (the source of the timestamp year).
"""

from __future__ import annotations

import json
import urllib.request
from typing import Callable

ANTHROPIC = "https://status.claude.com"


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def fetch_history(
    base: str = ANTHROPIC,
    max_pages: int = 16,
    get_json: Callable[[str], dict] = _get_json,
) -> list[dict]:
    """Return raw history incidents, each annotated with ``_year`` and ``_month``.

    Stops at the first page with zero incidents (inception reached) or at
    ``max_pages`` as a backstop.
    """
    incidents: list[dict] = []
    for page in range(1, max_pages + 1):
        data = get_json(f"{base}/history.json?page={page}")
        page_incidents = [
            {**inc, "_year": month["year"], "_month": month["name"]}
            for month in data.get("months", [])
            for inc in month.get("incidents", [])
        ]
        if not page_incidents:
            break
        incidents.extend(page_incidents)
    return incidents
