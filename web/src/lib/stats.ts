import { dayKey, daysUntil, lastDays } from "./format";
import type { IntelEvent, RunRecord, StatusFile } from "./types";

export function dailyCounts(events: IntelEvent[], tz: string, days = 7, now = new Date()) {
  const keys = lastDays(days, tz, now);
  const counts = new Map(keys.map((k) => [k, { day: k, changes: 0, high: 0, baseline: 0 }]));
  for (const e of events) {
    const row = counts.get(dayKey(e.detected_at, tz));
    if (!row) continue;
    if (e.change_type === "initial") row.baseline++;
    else {
      row.changes++;
      if (e.level === "high") row.high++;
    }
  }
  return [...counts.values()];
}

export function successRate(run: RunRecord | null | undefined): number | null {
  if (!run) return null;
  const checked = run.sources_total - run.sources_paused;
  return checked > 0 ? run.sources_ok / checked : null;
}

/** Average success rate over the runs in the last `days` days. */
export function successRateOverDays(runs: RunRecord[], days: number, now = new Date()): number | null {
  const since = now.getTime() - days * 86_400_000;
  let ok = 0;
  let checked = 0;
  for (const r of runs) {
    if (Date.parse(r.started_at) < since) continue;
    ok += r.sources_ok;
    checked += r.sources_total - r.sources_paused;
  }
  return checked > 0 ? ok / checked : null;
}

export function upcomingDeadlines(events: IntelEvent[], tz: string, withinDays = 30, now = new Date()) {
  const seen = new Set<string>();
  return events
    .filter((e) => e.deadline && e.change_type !== "removed")
    .map((e) => ({ event: e, days: daysUntil(e.deadline!, tz, now) }))
    .filter(({ event, days }) => {
      const key = event.url + event.deadline;
      if (days < 0 || days > withinDays || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.days - b.days);
}

export function categoryDistribution(events: IntelEvent[]) {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

export function failingSources(status: StatusFile | null) {
  if (!status) return [];
  return Object.values(status.sources).filter((s) => ["fetch_error", "parse_error", "blocked"].includes(s.status));
}
