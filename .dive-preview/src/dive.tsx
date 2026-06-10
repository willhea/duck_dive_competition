import { useEffect, useMemo, useState } from "react";
import { useSQLQuery, useDiveState } from "@motherduck/react-sql-query";
import {
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import * as d3 from "d3";

const N = (v: unknown): number => (v != null ? Number(v) : 0);

const TABLE = `"my_db"."main"."claude_outages"`;
const INK = "#231f20";
const MUTED = "#6a6a6a";
const BLUE = "#0777b3";
const SEV = { critical: "#bc1200", major: "#e18727", minor: "#638CAD" };

// Anthropic-branded: cream -> Claude coral (#D97757) as the darkest/hottest.
const PALETTE = {
  interp: d3.interpolateRgbBasis(["#FAF6F0", "#F0DAC8", "#E3A983", "#D97757"]),
  range: [0.04, 1] as [number, number],
};

type Metric = "incidents" | "hours" | "recovery";
type Tab = "overtime" | "longest" | "timezone" | "world";

export default function ClaudeOutages() {
  const [tab, setTab] = useDiveState<Tab>("tab", "overtime");
  const [metric, setMetric] = useDiveState<Metric>("metric", "hours");
  const [tz, setTz] = useDiveState<string>("tz", "America/New_York");
  const [startH, setStartH] = useDiveState<number>("start", 9);
  const [endH, setEndH] = useDiveState<number>("end", 17);
  // severities hidden from the Over-time chart (click a legend entry to toggle)
  const [hidden, setHidden] = useDiveState<string[]>("hidden", []);
  const toggleSev = (name: string) =>
    setHidden(hidden.includes(name) ? hidden.filter((s) => s !== name) : [...hidden, name]);

  // Lazy-warm the World map: once the initial view has rendered, prefetch the
  // geometry + per-offset data in the background so opening that tab is instant.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWarm(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const kpi = useSQLQuery(`
    SELECT
      count(*) AS incidents,
      round(sum(duration_minutes) FILTER (WHERE is_outage) / 60) AS outage_hours,
      count(*) FILTER (WHERE impact = 'critical') AS critical,
      -- every UTC calendar day an outage was IN PROGRESS (not just its start day),
      -- pinned to UTC so the count doesn't drift with the viewer's timezone.
      (SELECT count(DISTINCT d) FROM (
         SELECT unnest(generate_series(
           date_trunc('day', started_at AT TIME ZONE 'UTC'),
           date_trunc('day', ended_at   AT TIME ZONE 'UTC'),
           INTERVAL 1 DAY)) AS d
         FROM ${TABLE} WHERE is_outage)) AS days_out,
      datediff('day', min(started_at), max(started_at)) AS span_days
    FROM ${TABLE}
  `);

  const tzList = useSQLQuery(`SELECT name FROM pg_timezone_names() ORDER BY name`);

  const monthly = useSQLQuery(`
    SELECT strftime(d, '%y-%b') AS label,
      count(o.code) FILTER (WHERE o.impact = 'minor')    AS minor,
      count(o.code) FILTER (WHERE o.impact = 'major')    AS major,
      count(o.code) FILTER (WHERE o.impact = 'critical') AS critical,
      round(coalesce(sum(o.duration_minutes) FILTER (WHERE o.impact = 'minor'), 0) / 60, 1)    AS hours_minor,
      round(coalesce(sum(o.duration_minutes) FILTER (WHERE o.impact = 'major'), 0) / 60, 1)    AS hours_major,
      round(coalesce(sum(o.duration_minutes) FILTER (WHERE o.impact = 'critical'), 0) / 60, 1) AS hours_critical,
      round(median(o.duration_minutes) FILTER (WHERE o.duration_minutes > 0) / 60, 1)          AS mttr_hours
    FROM generate_series(
           DATE '2023-03-01',
           -- stop at the last COMPLETE month so the current partial month
           -- (data ends mid-month) doesn't render as a misleading cliff.
           (date_trunc('month', (SELECT max(started_at) FROM ${TABLE})) - INTERVAL 1 MONTH)::date,
           INTERVAL 1 MONTH) AS t(d)
    LEFT JOIN ${TABLE} o
      ON date_trunc('month', o.started_at) = t.d AND o.is_outage
    GROUP BY d ORDER BY d
  `, { enabled: tab === "overtime" });

  const split = useSQLQuery(`
    WITH local AS (
      SELECT extract('hour' FROM (started_at AT TIME ZONE '${tz}')) AS h,
             isodow(started_at AT TIME ZONE '${tz}') AS d
      FROM ${TABLE} WHERE is_outage
    )
    SELECT count(*) AS total,
      count(*) FILTER (WHERE h >= ${startH} AND h < ${endH} AND d <= 5) AS in_biz
    FROM local
  `, { enabled: tab === "timezone" });

  const hourly = useSQLQuery(`
    SELECT extract('hour' FROM (started_at AT TIME ZONE '${tz}')) AS hr, count(*) AS n
    FROM ${TABLE} WHERE is_outage GROUP BY 1 ORDER BY 1
  `, { enabled: tab === "timezone" });

  const longest = useSQLQuery(`
    SELECT name, round(duration_minutes / 60, 1) AS hours, impact,
      strftime(started_at, '%b %-d, %Y') AS day, url
    FROM ${TABLE} WHERE is_outage ORDER BY duration_minutes DESC LIMIT 8
  `, { enabled: tab === "longest" });

  // World map: % of outages during local workday, per UTC offset band
  const offsetPct = useSQLQuery(`
    WITH base AS (SELECT (started_at AT TIME ZONE 'UTC') AS utc_ts FROM ${TABLE} WHERE is_outage),
    offs AS (SELECT unnest(generate_series(-11, 12)) AS off),
    local AS (SELECT off, utc_ts + (off * INTERVAL 1 HOUR) AS lt FROM base CROSS JOIN offs)
    SELECT off,
      round(100.0 * count(*) FILTER (
        WHERE extract('hour' FROM lt) >= ${startH} AND extract('hour' FROM lt) < ${endH}
          AND isodow(lt) <= 5) / count(*)) AS pct
    FROM local GROUP BY off ORDER BY off
  `, { enabled: tab === "world" || warm });

  const worldGeo = useSQLQuery(
    `SELECT name, off, geom FROM "my_db"."main"."world_countries"`,
    { enabled: tab === "world" || warm },
  );

  const k = (Array.isArray(kpi.data) ? kpi.data : [])[0] ?? {};
  const tzNames = (Array.isArray(tzList.data) ? tzList.data : []).map((r) => r.name as string);
  const months = (Array.isArray(monthly.data) ? monthly.data : []).map((r) => ({
    label: r.label as string,
    minor: N(r.minor), major: N(r.major), critical: N(r.critical),
    hours_minor: N(r.hours_minor), hours_major: N(r.hours_major), hours_critical: N(r.hours_critical),
    mttr: r.mttr_hours != null ? N(r.mttr_hours) : 0,
  }));
  const s = (Array.isArray(split.data) ? split.data : [])[0] ?? {};
  const total = N(s.total), inBiz = N(s.in_biz);
  const bizPct = total > 0 ? Math.round((100 * inBiz) / total) : 0;
  const hoursById = new Map(
    (Array.isArray(hourly.data) ? hourly.data : []).map((r) => [N(r.hr), N(r.n)]),
  );
  const hourBars = Array.from({ length: 24 }, (_, h) => ({
    hr: h, n: hoursById.get(h) ?? 0, inBiz: h >= startH && h < endH,
  }));
  const rows = Array.isArray(longest.data) ? longest.data : [];
  const daysOut = N(k.days_out), span = N(k.span_days);
  const oneIn = daysOut > 0 ? (span / daysOut).toFixed(1) : "—";

  // World map derived data
  const pctByOff = new Map(
    (Array.isArray(offsetPct.data) ? offsetPct.data : []).map((r) => [N(r.off), N(r.pct)]),
  );
  const pctValues = [...pctByOff.values()];
  const ext: [number, number] = pctValues.length
    ? [Math.min(...pctValues), Math.max(...pctValues)] : [0, 1];
  // Map pct -> a clamped slice of Reds so the darkest band isn't near-black
  // (keeps country borders legible) and the lightest still carries a tint.
  const tScale = d3.scaleLinear().domain(ext).range(PALETTE.range).clamp(true);
  const color = (pct: number) => PALETTE.interp(tScale(pct));
  const fill = (off: number) => (pctByOff.has(off) ? color(pctByOff.get(off)!) : "#e6e6e6");

  const world = useMemo(() => {
    const geo = Array.isArray(worldGeo.data) ? worldGeo.data : [];
    if (!geo.length) return { countries: [] as { name: string; d: string }[], bands: [] as { off: number; x: number; w: number }[] };
    const features = geo.map((r) => {
      try {
        return { type: "Feature", properties: { name: r.name as string },
                 geometry: JSON.parse(r.geom as string) };
      } catch { return null; }
    }).filter(Boolean) as any[];
    // Equirectangular: longitude maps linearly to x, so timezone bands are true vertical stripes.
    const projection = d3.geoEquirectangular().fitSize([960, 480], { type: "FeatureCollection", features } as any);
    const path = d3.geoPath(projection);
    const countries = features.map((f) => ({ name: f.properties.name, d: path(f) ?? "" }));
    // UTC-12..+12: the date-line zone is split by the ±180° seam into two
    // half-bands (UTC-12 on the far left, UTC+12 on the far right). UTC-12 has
    // no population/data, so it renders in the neutral gray, accurate size, no heat.
    const bands = Array.from({ length: 25 }, (_, i) => i - 12).map((off) => {
      // clamp to [-180,180] so the UTC+12/-12 edge bands don't wrap the date line
      const lonW = Math.max(-180, off * 15 - 7.5);
      const lonE = Math.min(180, off * 15 + 7.5);
      const xl = projection([lonW, 0])![0];
      const xr = projection([lonE, 0])![0];
      return { off, x: Math.min(xl, xr), w: Math.abs(xr - xl) };
    });
    return { countries, bands };
  }, [worldGeo.data]);

  return (
    <div className="p-6" style={{ background: "#f8f8f8", color: INK }}>
      <h1 className="text-2xl font-semibold">Dive Into Claude Outages</h1>
      <p className="text-sm mb-6" style={{ color: MUTED }}>
        Every incident on Anthropic's public status page, March 2023 – June 2026.
      </p>

      {/* KPIs — always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 mb-6">
        <Kpi loading={kpi.isLoading} value={N(k.incidents).toLocaleString()} label="status-page incidents" />
        <Kpi loading={kpi.isLoading} value={N(k.outage_hours).toLocaleString()} label="incident-hours (mostly minor, partial-impact)" />
        <Kpi loading={kpi.isLoading} value={N(k.critical).toString()} label="critical incidents" color={SEV.critical} />
        <Kpi loading={kpi.isLoading} value={daysOut.toString()} label={`days with an outage in progress · ~1 in ${oneIn}`} />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: "1px solid #e0e0e0" }}>
        {([["overtime", "Over time"], ["longest", "Longest incidents"], ["timezone", "Your timezone"], ["world", "World map"]] as [Tab, string][])
          .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className="text-sm px-3 py-2"
              style={tab === id
                ? { color: BLUE, fontWeight: 600, borderBottom: `2px solid ${BLUE}`, marginBottom: -1 }
                : { color: MUTED }}>
              {label}
            </button>
          ))}
      </div>

      {tab === "overtime" && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            {(["hours", "incidents", "recovery"] as Metric[]).map((m) => (
              <button key={m} onClick={() => setMetric(m)}
                className="text-xs px-2 py-1 rounded"
                style={metric === m ? { background: BLUE, color: "white" } : { background: "#e6e6e6", color: INK }}>
                {m === "hours" ? "Incident-hours" : m === "incidents" ? "Incident count" : "Recovery time"}
              </button>
            ))}
            <span className="text-xs" style={{ color: MUTED }}>
              {metric === "hours" ? "monthly incident-hours, by severity"
                : metric === "incidents" ? "monthly incidents, by severity"
                : "median hours from report to resolution"}
            </span>
          </div>
          {monthly.isLoading ? (
            <div className="bg-gray-100 animate-pulse rounded" style={{ height: 260 }} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={months} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="label" fontSize={10} interval={5} tickLine={false} />
                <YAxis fontSize={10} tickLine={false} axisLine={false}
                  tickFormatter={metric === "recovery" ? (v) => `${v}h` : undefined} />
                <Tooltip />
                {metric === "incidents" ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                      onClick={(e) => toggleSev(String(e.value))} />
                    <Bar dataKey="minor" stackId="1" name="minor" fill={SEV.minor} hide={hidden.includes("minor")} />
                    <Bar dataKey="major" stackId="1" name="major" fill={SEV.major} hide={hidden.includes("major")} />
                    <Bar dataKey="critical" stackId="1" name="critical" fill={SEV.critical} hide={hidden.includes("critical")} />
                  </>
                ) : metric === "hours" ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                      onClick={(e) => toggleSev(String(e.value))} />
                    <Bar dataKey="hours_minor" stackId="1" name="minor" fill={SEV.minor} hide={hidden.includes("minor")} />
                    <Bar dataKey="hours_major" stackId="1" name="major" fill={SEV.major} hide={hidden.includes("major")} />
                    <Bar dataKey="hours_critical" stackId="1" name="critical" fill={SEV.critical} hide={hidden.includes("critical")} />
                  </>
                ) : (
                  <Bar dataKey="mttr" name="median hours" fill={BLUE} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
          {metric !== "recovery" && (
            <p className="text-xs mt-2" style={{ color: MUTED }}>
              {metric === "hours"
                ? "Hours sum overlapping incidents and are mostly minor, partial-impact degradation, not full downtime — and the trend partly reflects a growing product surface and finer-grained reporting, not reliability alone."
                : "Count also reflects a growing product surface and finer-grained reporting over time, not reliability alone."}
            </p>
          )}
        </div>
      )}

      {tab === "timezone" && (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs mb-3" style={{ color: MUTED }}>
            <span>My timezone</span>
            <select value={tz} onChange={(e) => setTz(e.target.value)}
              className="px-2 py-1 rounded" style={{ background: "white", border: "1px solid #ccc", color: INK }}>
              {tzNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <span>workday</span>
            <HourSelect value={startH} onChange={setStartH} />
            <span>to</span>
            <HourSelect value={endH} onChange={setEndH} />
            <span>Mon–Fri</span>
          </div>
          <p className="text-sm mb-3">
            {split.isLoading ? (
              <span style={{ color: MUTED }}>calculating…</span>
            ) : (
              <>
                <span className="text-3xl font-bold" style={{ color: BLUE }}>{bizPct}%</span>
                <span style={{ color: MUTED }}> of outages began during your working hours
                  {" "}({inBiz.toLocaleString()} of {total.toLocaleString()}).</span>
              </>
            )}
          </p>
          {hourly.isLoading ? (
            <div className="bg-gray-100 animate-pulse rounded" style={{ height: 200 }} />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourBars} margin={{ top: 0, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="hr" fontSize={9} tickLine={false} />
                <YAxis fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(h) => `${h}:00`} />
                <Bar dataKey="n" name="outages">
                  {hourBars.map((b, i) => <Cell key={i} fill={b.inBiz ? BLUE : "#cfcfcf"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs mt-2" style={{ color: MUTED }}>Outage start hour, local to your timezone (blue = your workday).</p>
        </div>
      )}

      {tab === "longest" && (
        longest.isLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-2/3" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #e6e6e6" }}>
                  <td className="py-2 pr-3 font-medium" style={{ width: 70 }}>{N(r.hours).toFixed(0)}h</td>
                  <td className="py-2 pr-3">
                    <a href={r.url as string} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>
                      {r.name as string}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-right" style={{ color: MUTED, width: 110 }}>{r.day as string}</td>
                  <td className="py-2 text-right" style={{ color: SEV[(r.impact as keyof typeof SEV)] ?? MUTED, width: 70 }}>
                    {r.impact as string}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === "world" && (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs mb-3" style={{ color: MUTED }}>
            <span>Workday</span>
            <HourSelect value={startH} onChange={setStartH} />
            <span>to</span>
            <HourSelect value={endH} onChange={setEndH} />
            <span>Mon–Fri, local to each region</span>
          </div>
          <p className="text-sm mb-3" style={{ color: MUTED }}>
            Claude's outages are global: each one happens at a single moment worldwide. This shades
            every timezone by how often that moment lands inside the local 9-to-5, so darker means the
            outage clock tends to line up with the workday there, <em>not</em> that the region is hit harder.
          </p>

          {(worldGeo.isLoading || offsetPct.isLoading || !world.countries.length) ? (
            <div className="bg-gray-100 animate-pulse rounded" style={{ height: 300 }} />
          ) : (
            <svg viewBox="0 50 960 350" width="100%" style={{ height: "auto", background: "#eef1f4" }}>
              {/* colored timezone bands as the base layer (full saturation) */}
              {world.bands.map((b) => (
                <rect key={b.off} x={b.x} y={0} width={b.w} height={480} fill={fill(b.off)}>
                  <title>UTC{b.off >= 0 ? "+" : ""}{b.off} — {pctByOff.has(b.off) ? `${pctByOff.get(b.off)}%` : "—"} of outages during workday</title>
                </rect>
              ))}
              {/* band divider lines so timezones read as discrete stripes */}
              {world.bands.map((b) => (
                <line key={`l${b.off}`} x1={b.x} y1={0} x2={b.x} y2={480} stroke="#ffffff" strokeWidth={0.6} strokeOpacity={0.5} />
              ))}
              {/* two-tone country borders ("casing"): dark underneath reads on light bands,
                  white on top reads on dark bands — so outlines show on any heat level */}
              {world.countries.map((c, i) => (
                <path key={`d${i}`} d={c.d} fill="none" stroke="#000000" strokeWidth={1.3} strokeOpacity={0.35} style={{ pointerEvents: "none" }} />
              ))}
              {world.countries.map((c, i) => (
                <path key={`w${i}`} d={c.d} fill="none" stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.9} style={{ pointerEvents: "none" }} />
              ))}
            </svg>
          )}

          {/* Color legend */}
          <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: MUTED }}>
            <span>less</span>
            <div style={{
              width: 120, height: 10, borderRadius: 2,
              background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
                .map((f) => color(ext[0] + f * (ext[1] - ext[0]))).join(", ")})`,
            }} />
            <span>more often during workday</span>
          </div>
          <p className="text-xs mt-3" style={{ color: MUTED }}>
            Each region is shaded by its representative timezone. Large countries spanning several
            timezones (US, Russia) use a single offset, so treat those as approximate.
          </p>
        </div>
      )}

      <p className="text-xs mt-6" style={{ color: MUTED }}>
        Source: Anthropic status page (status.claude.com). Reflects incidents Anthropic posted publicly.
      </p>
    </div>
  );
}

function Kpi({ loading, value, label, color }: {
  loading: boolean; value: string; label: string; color?: string;
}) {
  return (
    <div>
      {loading ? (
        <div className="h-12 w-20 bg-gray-200 animate-pulse rounded" />
      ) : (
        <p className="text-5xl font-bold" style={{ color: color ?? INK }}>{value}</p>
      )}
      <p className="text-sm mt-2" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}
      className="px-2 py-1 rounded" style={{ background: "white", border: "1px solid #ccc", color: INK }}>
      {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
    </select>
  );
}
