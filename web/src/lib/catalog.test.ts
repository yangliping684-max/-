import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG_FILTER, activeFilterCount, countBy, filterRows, recentlyAdded, sortRows, toRows,
  type CatalogIndex, type SourceCatalog,
} from "./catalog";

const now = new Date("2026-10-12T08:00:00Z");
const index: CatalogIndex = {
  generated_at: now.toISOString(), total: 4,
  companies: [
    { source_id: "a", company: "Alpha 制造", source_name: "A", industry: "制造业", careers_url: "https://a", channel: "x",
      count: 3, complete: true, total_reported: 3, has_catalog: true, updated_at: null },
    { source_id: "b", company: "Beta 物流", source_name: "B", industry: "物流", careers_url: "https://b", channel: "x",
      count: 1, complete: false, total_reported: 5, has_catalog: true, updated_at: null },
  ],
};
const cats: SourceCatalog[] = [
  { source_id: "a", company: "Alpha 制造", industry: "制造业", complete: true, total_reported: 3, fetched: 3, jobs: [
    { id: "1", title: "采购工程师", url: "https://a/1", published_at: "2026-10-10T00:00:00Z", first_seen: "2026-10-01T00:00:00Z",
      baseline: true, city: "Suzhou", region: "Jiangsu", function: "采购", job_type: "社会招聘" },
    { id: "2", title: "物料计划实习生 2027届", url: "https://a/2", published_at: "2026-10-11T00:00:00Z", first_seen: "2026-10-11T07:00:00Z",
      city: "Wuxi", region: "Jiangsu", function: "物料控制、生产计划", job_type: "实习", grad_year: "2027", education: "本科" },
    { id: "3", title: "Sales Manager", url: "https://a/3", published_at: null, first_seen: "2026-10-01T00:00:00Z", baseline: true, city: "Xian" },
  ] },
  { source_id: "b", company: "Beta 物流", industry: "物流", complete: false, total_reported: 5, fetched: 1, jobs: [
    { id: "9", title: "Warehouse Supervisor", url: "https://b/9", published_at: "2026-09-01T00:00:00Z", first_seen: "2026-10-11T00:00:00Z",
      location: "Shanghai, China", function: "仓储", unconfirmed: true },
  ] },
];
const rows = toRows(cats, index);
const local = { saved: {} as Record<string, unknown>, viewed: {} as Record<string, number> };
const ids = (f = {}, l = local) => filterRows(rows, { ...DEFAULT_CATALOG_FILTER, ...f }, l, now).map((r) => r.uid);

describe("catalog rows", () => {
  it("joins company metadata and builds stable uids", () => {
    expect(rows.map((r) => r.uid)).toEqual(["a:1", "a:2", "a:3", "b:9"]);
    expect(rows[3].companyName).toBe("Beta 物流");
    expect(rows[0].industryName).toBe("制造业");
  });
});

describe("catalog filters", () => {
  it("shows every open job by default", () => expect(ids()).toHaveLength(4));
  it("company, province, city and function", () => {
    expect(ids({ companies: ["b"] })).toEqual(["b:9"]);
    expect(ids({ region: "jiangsu", includeUnknown: false })).toEqual(["a:1", "a:2"]);
    expect(ids({ city: "shanghai" , includeUnknown: false })).toEqual(["b:9"]);
    expect(ids({ func: "生产计划" })).toEqual(["a:2"]);
  });
  it("optional criteria respect 'include unknown'", () => {
    expect(ids({ gradYear: "2027" })).toEqual(["a:1", "a:2", "a:3", "b:9"]);
    expect(ids({ gradYear: "2027", includeUnknown: false })).toEqual(["a:2"]);
    expect(ids({ education: "本科", includeUnknown: false })).toEqual(["a:2"]);
    expect(ids({ jobType: "实习", includeUnknown: false })).toEqual(["a:2"]);
  });
  it("time windows: published vs first seen (baseline never counts as new)", () => {
    expect(ids({ publishedWithinDays: 7, includeUnknown: false })).toEqual(["a:1", "a:2"]);
    expect(ids({ firstSeenWithinDays: 7 })).toEqual(["a:2", "b:9"]);
    expect(ids({ onlyNew: true })).toEqual(["a:2", "b:9"]);
  });
  it("keyword search over title, department, location, company", () => {
    expect(ids({ q: "实习 2027" })).toEqual(["a:2"]);
    expect(ids({ q: "beta" })).toEqual(["b:9"]);
  });
  it("local saved / unviewed views", () => {
    const l = { saved: { "a:3": {} }, viewed: { "a:1": 1, "a:2": 1 } };
    expect(ids({ view: "saved" }, l)).toEqual(["a:3"]);
    expect(ids({ view: "unviewed" }, l)).toEqual(["a:3", "b:9"]);
  });
});

describe("catalog stats & sorting", () => {
  it("counts cities and functions (multi-valued)", () => {
    expect(countBy(rows, (j) => j.region)).toEqual([["Jiangsu", 2]]);
    expect(countBy(rows, (j) => j.function, true).map(([k]) => k)).toEqual(["仓储", "物料控制", "生产计划", "采购"]);
  });
  it("recently added excludes baseline", () => {
    expect(recentlyAdded(rows, 7, now).map((r) => r.uid)).toEqual(["a:2", "b:9"]);
  });
  it("sorts by publication, first seen and company", () => {
    expect(sortRows(rows, "published")[0].uid).toBe("a:2");
    expect(sortRows(rows, "first_seen").map((r) => r.uid).slice(0, 2)).toEqual(["a:2", "b:9"]);
    expect(sortRows(rows, "company")[0].companyName).toBe("Alpha 制造");
  });
  it("counts active filters", () => {
    expect(activeFilterCount({ ...DEFAULT_CATALOG_FILTER, q: "x", companies: ["a"], onlyNew: true })).toBe(3);
  });
});
