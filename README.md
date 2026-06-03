# Duck Dive Competition

Entries for MotherDuck's [DiveMaxxing](https://motherduck.com/divemaxxing/) competition (closes June 22, 2026):
interactive, shareable data visualizations ("Dives") built by AI agents on live MotherDuck data.

## Concept #1: A Year of AI Outages

A Dive mapping reliability and downtime across AI providers (Claude, OpenAI, Gemini, and more),
built from public status-page incident data. Targets **Most Creative** and **Community Favorite**:
the contest's voters are the developers who feel these outages firsthand.

### Data pipeline

This repo holds the **data prep** that feeds the Dive. The Dive itself is built conversationally
in MotherDuck via the MCP server; this code produces and refreshes the table it queries.

```
src/outage_data/
  sources.py     provider registry (name, category, source type, url)
  fetch.py       fetch raw incident data per source type
  normalize.py   raw provider formats -> one common incident schema   (TDD core)
  load.py        write normalized incidents to DuckDB / MotherDuck
  cli.py         orchestrate a full refresh
tests/
  fixtures/      real captured API responses, trimmed
  test_normalize.py
```

Three source formats are normalized to a common schema: **Atlassian Statuspage**
(`/api/v2/incidents.json`), **Google Cloud** (`incidents.json`), and **Instatus**.

### Run

```bash
uv sync
uv run pytest          # tests
uv run python -m outage_data.cli   # fetch + normalize + load
```

## Submissions

See [SUBMISSIONS.md](SUBMISSIONS.md) for the ledger of entries and results.
