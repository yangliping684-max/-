import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTER, countActive, facetOptions, filterJobs } from "./jobs";
import type { IntelEvent } from "./types";

const now = new Date("2026-10-11T08:00:00Z");
const job = (id: string, facets: Record<string, string>, over: Partial<IntelEvent> = {}): IntelEvent => ({
  id, source_id: "s", source_name: "Src", category: "jobs", change_type: "added", title: `job ${id}`, url: "https://x",
  summary: "", detected_at: now.toISOString(), published_at: "2026-10-09T00:00:00Z", source_updated_at: null,
  matched_keywords: [], alert_keywords: [], deadline: null, score: 50, level: "medium", score_factors: [], diff: null,
  extra: {}, facets, ...over,
});

const jobs = [
  job("a", { grad_year: "2027", education: "本科", city: "Suzhou", job_type: "实习", function: "采购", company: "Bosch" }),
  job("b", { grad_year: "2026、2027", education: "硕士", city: "Shanghai", job_type: "校园招聘", function: "供应链、物料控制" }),
  job("c", { city: "Wuxi", function: "物流" }, { published_at: null }),
  job("d", { grad_year: "2028", job_type: "实习" }, { published_at: "2026-08-01T00:00:00Z" }),
  job("e", { job_type: "实习" }, { change_type: "removed" }),
];
const ids = (f = {}) => filterJobs(jobs, { ...DEFAULT_JOB_FILTER, ...f }, now).map((e) => e.id);

describe("job filters", () => {
  it("nothing is filtered by default except removed postings", () => {
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    expect(ids({ includeRemoved: true })).toContain("e");
  });
  it("graduation year is optional and supports multi-year postings", () => {
    expect(ids({ gradYear: "2027" })).toEqual(["a", "b", "c"]); // c does not state a year
    expect(ids({ gradYear: "2027", includeUnknown: false })).toEqual(["a", "b"]);
    expect(ids({ gradYear: "2028", includeUnknown: false })).toEqual(["d"]);
  });
  it("education, job type, city, function and company", () => {
    expect(ids({ education: "硕士", includeUnknown: false })).toEqual(["b"]);
    expect(ids({ jobType: "实习", includeUnknown: false })).toEqual(["a", "d"]);
    expect(ids({ city: "shang" , includeUnknown: false })).toEqual(["b"]);
    expect(ids({ func: "物料控制" })).toEqual(["b"]);
    expect(ids({ company: "bosch" })).toEqual(["a"]);
  });
  it("publication window never uses detection time for unknown dates", () => {
    expect(ids({ publishedWithinDays: 7 })).toEqual(["a", "b", "c"]);
    expect(ids({ publishedWithinDays: 7, includeUnknown: false })).toEqual(["a", "b"]);
  });
  it("keyword search covers facets", () => {
    expect(ids({ keyword: "供应链" })).toEqual(["b"]);
  });
  it("facet options and active count", () => {
    expect(facetOptions(jobs, "grad_year", true)).toEqual(["2027", "2026", "2028"]);
    expect(countActive({ ...DEFAULT_JOB_FILTER, city: "x", includeUnknown: false })).toBe(1);
  });
  it("v0.1 events without facets are still listed", () => {
    const old = { ...job("z", {}), facets: undefined };
    expect(filterJobs([old], DEFAULT_JOB_FILTER, now)).toHaveLength(1);
  });
});
