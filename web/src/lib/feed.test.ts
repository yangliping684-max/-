import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, filterEvents, filterFromParams, filterToParams, matchesQuery } from "./feed";
import type { IntelEvent } from "./types";

const ev = (over: Partial<IntelEvent>): IntelEvent => ({
  id: "e", source_id: "s", source_name: "Src", category: "ai", change_type: "added", title: "Title", url: "https://x",
  summary: "", detected_at: "2026-10-10T00:00:00Z", published_at: null, source_updated_at: null, matched_keywords: [],
  alert_keywords: [], deadline: null, score: 50, level: "medium", score_factors: [], diff: null, extra: {}, ...over,
});

const events = [
  ev({ id: "a", title: "Claude 新版本", score: 80, level: "high", detected_at: "2026-10-09T00:00:00Z" }),
  ev({ id: "b", title: "实习招聘", category: "jobs", score: 40, level: "low", detected_at: "2026-10-10T00:00:00Z", extra: { location: "北京" } }),
  ev({ id: "c", title: "baseline", change_type: "initial", score: 10, level: "low", detected_at: "2026-10-08T00:00:00Z" }),
];

describe("feed filtering", () => {
  it("sorts by time by default and by score on request", () => {
    expect(filterEvents(events, DEFAULT_FILTER, {}).map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, sort: "score" }, {}).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("applies view states from local prefs", () => {
    const items = { a: { read: 1 }, b: { archived: true }, c: { starred: true } };
    expect(filterEvents(events, { ...DEFAULT_FILTER, view: "inbox" }, items).map((e) => e.id)).toEqual(["a", "c"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, view: "unread" }, items).map((e) => e.id)).toEqual(["c"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, view: "archived" }, items).map((e) => e.id)).toEqual(["b"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, view: "starred" }, items).map((e) => e.id)).toEqual(["c"]);
  });
  it("filters by category, level, change type and baseline", () => {
    expect(filterEvents(events, { ...DEFAULT_FILTER, category: "jobs" }, {}).map((e) => e.id)).toEqual(["b"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, level: "high" }, {}).map((e) => e.id)).toEqual(["a"]);
    expect(filterEvents(events, { ...DEFAULT_FILTER, includeBaseline: false }, {}).map((e) => e.id)).toEqual(["b", "a"]);
  });
  it("keyword search matches all terms across fields", () => {
    expect(matchesQuery(events[1], "实习 北京")).toBe(true);
    expect(matchesQuery(events[1], "实习 上海")).toBe(false);
    expect(matchesQuery(events[0], "claude")).toBe(true);
  });
  it("round-trips through URL params", () => {
    const f = { ...DEFAULT_FILTER, q: "x y", sort: "score" as const, includeBaseline: false };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
    expect(filterToParams(DEFAULT_FILTER).toString()).toBe("");
  });
});

import { plainText } from "./utils";
describe("plainText", () => {
  it("strips release-note markdown for display", () => {
    expect(plainText("## [3.28.0](https://x/compare) (2026-10-09) ### Features * **api:** add `x` ([#4046](https://x/4046))"))
      .toBe("3.28.0 (2026-10-09) Features · api: add x (#4046)");
  });
});
