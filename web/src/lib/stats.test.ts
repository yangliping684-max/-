import { describe, expect, it } from "vitest";
import { dayKey, daysUntil, formatPublished } from "./format";
import { dailyCounts, successRate, successRateOverDays, upcomingDeadlines } from "./stats";
import type { IntelEvent, RunRecord } from "./types";

const now = new Date("2026-10-10T08:00:00Z");
const ev = (over: Partial<IntelEvent>): IntelEvent => ({
  id: Math.random().toString(), source_id: "s", source_name: "S", category: "ai", change_type: "added", title: "t",
  url: "https://x/" + Math.random(), summary: "", detected_at: now.toISOString(), published_at: null, source_updated_at: null,
  matched_keywords: [], alert_keywords: [], deadline: null, score: 50, level: "medium", score_factors: [], diff: null, extra: {}, ...over,
});
const run = (over: Partial<RunRecord>): RunRecord => ({
  id: "r", started_at: now.toISOString(), finished_at: now.toISOString(), trigger: "schedule", sources_total: 4, sources_ok: 3,
  sources_failed: 1, sources_paused: 0, new_events: 0, filtered: 0, duplicates: 0, errors: [], ...over,
});

describe("timezone-aware day keys", () => {
  it("uses the configured timezone, not UTC", () => {
    expect(dayKey("2026-10-09T17:00:00Z", "Asia/Shanghai")).toBe("2026-10-10");
    expect(dayKey("2026-10-09T17:00:00Z", "UTC")).toBe("2026-10-09");
  });
  it("counts days until a deadline", () => {
    expect(daysUntil("2026-10-15", "Asia/Shanghai", now)).toBe(5);
  });
  it("never presents a missing publish date as a date", () => {
    expect(formatPublished(null, false, "UTC")).toBe("发布日期未知");
  });
});

describe("stats", () => {
  it("daily counts separate baseline from changes", () => {
    const rows = dailyCounts([ev({}), ev({ change_type: "initial" }), ev({ level: "high" })], "Asia/Shanghai", 7, now);
    expect(rows).toHaveLength(7);
    expect(rows[6]).toMatchObject({ day: "2026-10-10", changes: 2, high: 1, baseline: 1 });
  });
  it("success rate excludes paused sources", () => {
    expect(successRate(run({ sources_total: 5, sources_paused: 1, sources_ok: 4 }))).toBe(1);
    expect(successRate(null)).toBeNull();
    expect(successRateOverDays([run({}), run({ started_at: "2026-09-01T00:00:00Z", sources_ok: 0 })], 7, now)).toBe(0.75);
  });
  it("upcoming deadlines are within range, sorted and deduplicated", () => {
    const a = ev({ deadline: "2026-10-20", url: "https://same" });
    const dup = ev({ deadline: "2026-10-20", url: "https://same" });
    const soon = ev({ deadline: "2026-10-12" });
    const past = ev({ deadline: "2026-10-01" });
    const far = ev({ deadline: "2027-01-01" });
    expect(upcomingDeadlines([a, dup, soon, past, far], "Asia/Shanghai", 30, now).map((d) => d.days)).toEqual([2, 10]);
  });
});
