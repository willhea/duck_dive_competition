from outage_data.fetch import fetch_history


def make_page(*month_specs):
    """month_specs: (name, year, n_incidents) -> a history.json-shaped page."""
    return {
        "months": [
            {"name": name, "year": year,
             "incidents": [{"code": f"{name}{i}", "impact": "minor",
                            "timestamp": "Jun 3, 01:00 - 01:10 UTC", "name": "x"}
                           for i in range(n)]}
            for name, year, n in month_specs
        ]
    }


def test_walks_until_empty_page():
    pages = {
        "b/history.json?page=1": make_page(("June", 2026, 2), ("May", 2026, 1)),
        "b/history.json?page=2": make_page(("April", 2026, 3)),
        "b/history.json?page=3": make_page(("March", 2026, 0)),  # empty -> stop
        "b/history.json?page=4": make_page(("Feb", 2026, 99)),   # never reached
    }
    out = fetch_history(base="b", get_json=lambda u: pages[u])
    assert len(out) == 6  # 2 + 1 + 3
    assert {i["code"] for i in out} >= {"June0", "June1", "May0", "April0"}


def test_annotates_year_and_month():
    pages = {"b/history.json?page=1": make_page(("May", 2025, 1)),
             "b/history.json?page=2": make_page(("X", 2025, 0))}
    out = fetch_history(base="b", get_json=lambda u: pages[u])
    assert out[0]["_year"] == 2025
    assert out[0]["_month"] == "May"


def test_respects_max_pages_backstop():
    # every page is full; max_pages caps the walk
    calls = []

    def get_json(u):
        calls.append(u)
        return make_page(("June", 2026, 1))

    fetch_history(base="b", max_pages=3, get_json=get_json)
    assert len(calls) == 3
