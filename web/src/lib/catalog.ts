// Current-openings catalog (data/jobs/*.json): every open posting, separate from change
// events. Loaded lazily by the job radar only; one small file per company.

import { useEffect, useState } from "react";
import { fetchJson } from "./data";

export interface CatalogJob {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  first_seen: string;
  baseline?: boolean; // present when the catalog was first built → not a "new" opening
  unconfirmed?: boolean; // kept from an earlier run because the latest fetch was incomplete
  date_only?: boolean;
  company?: string;
  location?: string;
  city?: string;
  region?: string;
  country?: string;
  industry?: string;
  job_type?: string;
  job_type_rule?: string;
  education?: string;
  grad_year?: string;
  function?: string;
  employment_type?: string;
  experience_level?: string;
  department?: string;
  position_type?: string;
}

export interface SourceCatalog {
  source_id: string;
  company: string;
  industry: string;
  complete: boolean;
  total_reported: number | null;
  fetched: number;
  updated_at?: string;
  jobs: CatalogJob[];
}

export interface CompanyEntry {
  source_id: string;
  company: string;
  source_name: string;
  industry: string;
  careers_url: string;
  channel: string;
  count: number;
  complete: boolean | null;
  total_reported: number | null;
  has_catalog: boolean;
  updated_at: string | null;
}

export interface CatalogIndex {
  generated_at: string;
  total: number;
  companies: CompanyEntry[];
}

/** A job joined with its company/source for display and filtering. */
export interface JobRow extends CatalogJob {
  uid: string; // `${source_id}:${id}` — stable across runs
  source_id: string;
  companyName: string;
  industryName: string;
}

export function jobUid(sourceId: string, id: string): string {
  return `${sourceId}:${id}`;
}

export function toRows(catalogs: SourceCatalog[], index: CatalogIndex | null): JobRow[] {
  const meta = new Map((index?.companies ?? []).map((c) => [c.source_id, c]));
  const rows: JobRow[] = [];
  for (const cat of catalogs) {
    const m = meta.get(cat.source_id);
    for (const j of cat.jobs) {
      rows.push({
        ...j,
        uid: jobUid(cat.source_id, j.id),
        source_id: cat.source_id,
        // The company configured for the source is authoritative; the API's own company
        // field (e.g. "Bosch Group") is kept on the job for display.
        companyName: m?.company || cat.company,
        industryName: j.industry || m?.industry || cat.industry || "",
      });
    }
  }
  return rows;
}

export interface CatalogState {
  index: CatalogIndex | null;
  rows: JobRow[];
  loading: boolean;
  loaded: number;
  errors: string[];
}

/** Loads the index, then every company file in parallel (each is small & gzip-served). */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ index: null, rows: [], loading: true, loaded: 0, errors: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const errors: string[] = [];
      let index: CatalogIndex | null = null;
      try {
        index = await fetchJson<CatalogIndex>("data/jobs/index.json");
      } catch (e) {
        errors.push(String(e));
      }
      if (!index) {
        if (!cancelled) setState({ index: null, rows: [], loading: false, loaded: 0, errors });
        return;
      }
      const ids = index.companies.filter((c) => c.has_catalog).map((c) => c.source_id);
      let loaded = 0;
      const cats = await Promise.all(ids.map(async (id) => {
        try {
          const c = await fetchJson<SourceCatalog>(`data/jobs/${id}.json`);
          loaded++;
          if (!cancelled) setState((s) => ({ ...s, index, loaded }));
          return c;
        } catch (e) {
          errors.push(`${id}: ${String(e)}`);
          return null;
        }
      }));
      if (!cancelled) {
        setState({ index, rows: toRows(cats.filter((c): c is SourceCatalog => !!c), index), loading: false, loaded, errors });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

// ------------------------------------------------------------------ filtering

export interface CatalogFilter {
  q: string; // title / department / location keywords (space separated, all must match)
  companies: string[]; // source ids; empty = all
  region: string; // province / state as stated by the source
  city: string;
  func: string; // job function group (from rules.json job_functions)
  jobType: string;
  education: string;
  gradYear: string;
  publishedWithinDays: number;
  firstSeenWithinDays: number;
  includeUnknown: boolean; // keep jobs that do not state the filtered field
  onlyNew: boolean; // exclude baseline (jobs present when the catalog was first built)
  view: "all" | "saved" | "unviewed";
}

export const DEFAULT_CATALOG_FILTER: CatalogFilter = {
  q: "",
  companies: [],
  region: "",
  city: "",
  func: "",
  jobType: "",
  education: "",
  gradYear: "",
  publishedWithinDays: 0,
  firstSeenWithinDays: 0,
  includeUnknown: true,
  onlyNew: false,
  view: "all",
};

const lc = (s: string | undefined) => (s ?? "").toLowerCase();

function stated(value: string | undefined, wanted: string, includeUnknown: boolean, contains = false): boolean {
  if (!wanted) return true;
  if (!value) return includeUnknown;
  const v = lc(value);
  const w = lc(wanted);
  return contains ? v.includes(w) : v.split("、").includes(w);
}

export function filterRows(
  rows: JobRow[],
  f: CatalogFilter,
  local: { saved: Record<string, unknown>; viewed: Record<string, number> },
  now: Date = new Date(),
): JobRow[] {
  const terms = lc(f.q).split(/\s+/).filter(Boolean);
  const companies = new Set(f.companies);
  const within = (iso: string | null | undefined, days: number) =>
    !!iso && now.getTime() - Date.parse(iso) <= days * 86_400_000;
  return rows.filter((j) => {
    if (f.view === "saved" && !local.saved[j.uid]) return false;
    if (f.view === "unviewed" && local.viewed[j.uid]) return false;
    if (companies.size && !companies.has(j.source_id)) return false;
    if (f.onlyNew && j.baseline) return false;
    if (!stated(j.region, f.region, f.includeUnknown, true)) return false;
    if (!stated(j.city || j.location, f.city, f.includeUnknown, true)) return false;
    if (f.func && !lc(j.function).split("、").includes(lc(f.func))) return false; // labels are never "unknown"-padded
    if (!stated(j.job_type, f.jobType, f.includeUnknown)) return false;
    if (!stated(j.education, f.education, f.includeUnknown)) return false;
    if (!stated(j.grad_year, f.gradYear, f.includeUnknown)) return false;
    if (f.publishedWithinDays > 0 && !(j.published_at ? within(j.published_at, f.publishedWithinDays) : f.includeUnknown)) return false;
    if (f.firstSeenWithinDays > 0 && (j.baseline || !within(j.first_seen, f.firstSeenWithinDays))) return false;
    if (terms.length) {
      const hay = lc([j.title, j.department, j.location, j.companyName, j.company, j.function, j.position_type].join(" "));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export type CatalogSort = "published" | "first_seen" | "company";

export function sortRows(rows: JobRow[], sort: CatalogSort): JobRow[] {
  const by = (k: (j: JobRow) => string) => (a: JobRow, b: JobRow) => k(b).localeCompare(k(a));
  if (sort === "company") return [...rows].sort((a, b) => a.companyName.localeCompare(b.companyName) || b.first_seen.localeCompare(a.first_seen));
  if (sort === "first_seen") return [...rows].sort(by((j) => j.first_seen));
  return [...rows].sort(by((j) => j.published_at ?? ""));
}

// ------------------------------------------------------------------ stats

export function countBy(rows: JobRow[], key: (j: JobRow) => string | undefined, split = false): [string, number][] {
  const m = new Map<string, number>();
  for (const j of rows) {
    const v = key(j);
    if (!v) continue;
    for (const part of split ? v.split("、") : [v]) m.set(part, (m.get(part) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Openings that appeared after the catalog was first built (never baseline). */
export function recentlyAdded(rows: JobRow[], days: number, now: Date = new Date()): JobRow[] {
  const since = now.getTime() - days * 86_400_000;
  return rows.filter((j) => !j.baseline && Date.parse(j.first_seen) >= since).sort((a, b) => b.first_seen.localeCompare(a.first_seen));
}

export function activeFilterCount(f: CatalogFilter): number {
  let n = 0;
  for (const k of ["q", "region", "city", "func", "jobType", "education", "gradYear"] as const) if (f[k]) n++;
  if (f.companies.length) n++;
  if (f.publishedWithinDays) n++;
  if (f.firstSeenWithinDays) n++;
  if (f.onlyNew) n++;
  return n;
}
