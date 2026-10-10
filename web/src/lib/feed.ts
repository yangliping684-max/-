import type { ItemState } from "./prefs";
import type { ChangeType, IntelEvent, Level } from "./types";

export type FeedView = "inbox" | "unread" | "starred" | "archived" | "all";
export type FeedSort = "time" | "score";

export interface FeedFilter {
  q: string;
  category: string;
  source: string;
  level: Level | "";
  change: ChangeType | "";
  view: FeedView;
  sort: FeedSort;
  includeBaseline: boolean;
}

export const DEFAULT_FILTER: FeedFilter = {
  q: "",
  category: "",
  source: "",
  level: "",
  change: "",
  view: "inbox",
  sort: "time",
  includeBaseline: true,
};

export function matchesQuery(e: IntelEvent, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [e.title, e.summary, e.source_name, ...e.matched_keywords, ...e.alert_keywords, ...Object.values(e.extra)]
    .join("\n")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function filterEvents(
  events: IntelEvent[],
  f: FeedFilter,
  items: Record<string, ItemState>,
): IntelEvent[] {
  const out = events.filter((e) => {
    const st = items[e.id] ?? {};
    switch (f.view) {
      case "inbox":
        if (st.archived) return false;
        break;
      case "unread":
        if (st.archived || st.read) return false;
        break;
      case "starred":
        if (!st.starred) return false;
        break;
      case "archived":
        if (!st.archived) return false;
        break;
    }
    if (!f.includeBaseline && e.change_type === "initial") return false;
    if (f.category && e.category !== f.category) return false;
    if (f.source && e.source_id !== f.source) return false;
    if (f.level && e.level !== f.level) return false;
    if (f.change && e.change_type !== f.change) return false;
    return matchesQuery(e, f.q);
  });
  return sortEvents(out, f.sort);
}

export function sortEvents(events: IntelEvent[], sort: FeedSort): IntelEvent[] {
  const byTime = (a: IntelEvent, b: IntelEvent) => b.detected_at.localeCompare(a.detected_at);
  return [...events].sort(sort === "score" ? (a, b) => b.score - a.score || byTime(a, b) : byTime);
}

export function filterToParams(f: FeedFilter): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    const d = DEFAULT_FILTER[k as keyof FeedFilter];
    if (v !== d) p.set(k, String(v));
  }
  return p;
}

export function filterFromParams(p: URLSearchParams): FeedFilter {
  const f: FeedFilter = { ...DEFAULT_FILTER };
  for (const k of Object.keys(DEFAULT_FILTER) as (keyof FeedFilter)[]) {
    const v = p.get(k);
    if (v === null) continue;
    if (k === "includeBaseline") f.includeBaseline = v === "true";
    else (f as unknown as Record<string, string>)[k] = v;
  }
  return f;
}
