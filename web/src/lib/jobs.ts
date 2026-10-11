// Job radar filtering. Everything is optional: no graduation year, degree or city is
// hard-coded — the user picks them in the UI and they are stored only in this browser.

import type { IntelEvent } from "./types";

export interface JobFilter {
  keyword: string;
  gradYear: string; // "2027"
  education: string; // 本科 / 硕士 / 博士 / 大专
  city: string;
  industry: string;
  company: string;
  jobType: string; // 实习 / 暑期实习 / 日常实习 / 校园招聘 / 应届生招聘 / 管培生 / 社会招聘
  func: string; // job function group, e.g. 采购
  publishedWithinDays: number; // 0 = any
  includeUnknown: boolean; // keep postings that do not state the filtered field
  includeRemoved: boolean;
}

export const DEFAULT_JOB_FILTER: JobFilter = {
  keyword: "",
  gradYear: "",
  education: "",
  city: "",
  industry: "",
  company: "",
  jobType: "",
  func: "",
  publishedWithinDays: 0,
  includeUnknown: true,
  includeRemoved: false,
};

export const JOB_TYPES = ["实习", "暑期实习", "日常实习", "校园招聘", "应届生招聘", "管培生", "社会招聘"];
export const EDUCATION_LEVELS = ["大专", "本科", "硕士", "博士"];

export function isJob(e: IntelEvent, jobSourceIds: Set<string>): boolean {
  return jobSourceIds.has(e.source_id) || e.category === "jobs";
}

/** A stated value must match; an absent value passes only when includeUnknown is on. */
function facetMatch(value: string | undefined, wanted: string, includeUnknown: boolean, contains = false): boolean {
  if (!wanted) return true;
  if (!value) return includeUnknown;
  const v = value.toLowerCase();
  const w = wanted.toLowerCase();
  return contains ? v.includes(w) : v.split("、").includes(w) || v === w;
}

export function filterJobs(events: IntelEvent[], f: JobFilter, now: Date = new Date()): IntelEvent[] {
  const terms = f.keyword.toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((e) => {
    const fc = e.facets ?? {};
    if (!f.includeRemoved && e.change_type === "removed") return false;
    if (!facetMatch(fc.grad_year, f.gradYear, f.includeUnknown)) return false;
    if (!facetMatch(fc.education, f.education, f.includeUnknown)) return false;
    if (!facetMatch(fc.city || fc.location, f.city, f.includeUnknown, true)) return false;
    if (!facetMatch(fc.industry, f.industry, f.includeUnknown, true)) return false;
    if (!facetMatch(fc.company || e.source_name, f.company, false, true)) return false;
    if (!facetMatch(fc.job_type, f.jobType, f.includeUnknown)) return false;
    if (!facetMatch(fc.function, f.func, false)) return false;
    if (f.publishedWithinDays > 0) {
      if (!e.published_at) {
        if (!f.includeUnknown) return false;
      } else if (now.getTime() - Date.parse(e.published_at) > f.publishedWithinDays * 86_400_000) return false;
    }
    if (terms.length) {
      const hay = [e.title, e.summary, ...Object.values(fc), ...Object.values(e.extra)].join("\n").toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Distinct values of a facet, most frequent first (for filter dropdowns). */
export function facetOptions(events: IntelEvent[], key: string, split = false): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const v = e.facets?.[key];
    if (!v) continue;
    for (const part of split ? v.split("、") : [v]) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

export function countActive(f: JobFilter): number {
  return (Object.keys(DEFAULT_JOB_FILTER) as (keyof JobFilter)[]).filter(
    (k) => !["includeUnknown", "includeRemoved"].includes(k) && f[k] !== DEFAULT_JOB_FILTER[k],
  ).length;
}
