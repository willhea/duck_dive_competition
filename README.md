# Dive Into Claude Outages

An interactive [MotherDuck Dive](https://motherduck.com/) charting every incident on Anthropic's
public status page, from March 2023 to today — built for MotherDuck's
[DiveMaxxing](https://motherduck.com/divemaxxing/) competition.

**Live Dive:** https://app.motherduck.com/dives/dive-into-claude-outages-76e85ff0-ad3f-49be-8ac0-56e61df36561

The Dive queries live data in MotherDuck. This repo is the pipeline that builds and refreshes the
table it reads, plus the Dive's React component.

## What's here

```
src/outage_data/      the data pipeline (fetch -> normalize -> load)
  fetch.py     walk Anthropic's Statuspage history.json back to inception (3 months/page)
  normalize.py parse the display-string timestamps into UTC intervals; skip unresolved incidents
  model.py     the common incident schema + the is_outage rule
  load.py      write DuckDB/Parquet locally and push to MotherDuck
  cli.py       one-command refresh
scripts/
  load_world.py      country geometry for the world-map tab (world_countries)
  load_timezones.py  real timezone polygons, Natural Earth (world_timezones)
.dive-preview/
  src/dive.tsx       the Dive component (React + MotherDuck useSQLQuery)
tests/                normalizer + dive-logic tests
```

## Data

Source: Anthropic's status page (`status.claude.com`), via the Atlassian Statuspage `history.json`
feed. Each incident is normalized to one common row:

```
provider, code, name, impact, is_outage, started_at, ended_at, duration_minutes, url
```

Methodology notes (the Dive states these too):

- **`is_outage`** = impact in {minor, major, critical}. Maintenance and informational posts are
  excluded from outage metrics but still counted as status-page incidents.
- **Incident-hours** sum overlapping incidents and are mostly minor, partial-impact degradation —
  not full downtime. The upward trend also tracks a growing product surface and finer-grained
  reporting, not reliability alone.
- **Zero-duration** incidents are faithful to the source (Anthropic logged identical start/end
  times); they count toward incident totals but contribute no hours.
- **Unresolved** incidents (a start but no end time yet) are skipped until Anthropic closes them.
- **Days with an outage** are counted in UTC across each incident's full span, so the figure does
  not drift with the viewer's timezone.

## Run

```bash
uv sync
uv run pytest                                                            # tests

# refresh the table the Dive reads (writes my_db.main.claude_outages)
MOTHERDUCK_DATABASE=my_db MOTHERDUCK_TOKEN=<token> uv run python -m outage_data.cli

# world-map geometry (one-time / on change)
MOTHERDUCK_TOKEN=<token> uv run --with pytz     python scripts/load_world.py
MOTHERDUCK_TOKEN=<token> uv run --with shapely  python scripts/load_timezones.py
```

Preview the Dive locally:

```bash
cd .dive-preview
npm install
echo "VITE_MOTHERDUCK_TOKEN=<token>" > .env
npm run dev        # http://localhost:5173
```

A short-lived MotherDuck token works for all of the above.

## License

MIT — see [LICENSE](LICENSE).
