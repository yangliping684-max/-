// Browser-local preferences. Everything here stays in this browser's localStorage:
// it is never sent anywhere and never committed to the repository.

import { useSyncExternalStore } from "react";
import { DEFAULT_CATALOG_FILTER, type CatalogFilter } from "./catalog";
import { DEFAULT_JOB_FILTER, type JobFilter } from "./jobs";
import type { Category, RulesConfig, Source } from "./types";

export interface ItemState {
  read?: number; // epoch ms
  starred?: boolean;
  archived?: boolean;
}

export interface SourceDrafts {
  upserts: Source[]; // new or edited sources (full objects)
  deletes: string[]; // ids of cloud sources to delete
  categories: Category[]; // new categories
}

export interface Prefs {
  theme: "light" | "dark" | "system";
  items: Record<string, ItemState>;
  drafts: SourceDrafts;
  rulesDraft: RulesConfig | null;
  repo: string; // "owner/repo" for GitHub links; empty = auto-detect
  branch: string;
  notificationsSeenAt: number;
  jobFilter: JobFilter; // v0.2 event-based filter (kept for compatibility)
  catalogFilter: CatalogFilter; // v0.3 job radar criteria — local only, never uploaded
  jobsViewed: Record<string, number>; // job uid → first viewed (epoch ms)
  jobsSaved: Record<string, SavedJob>; // snapshot so a saved job survives its removal
}

export interface SavedJob {
  title: string;
  url: string;
  company: string;
  location?: string;
  saved_at: number;
}

const KEY = "cr.prefs.v1";
const THEME_KEY = "cr.theme"; // read by the pre-paint script in index.html

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  items: {},
  drafts: { upserts: [], deletes: [], categories: [] },
  rulesDraft: null,
  repo: "",
  branch: "main",
  notificationsSeenAt: 0,
  jobFilter: DEFAULT_JOB_FILTER,
  catalogFilter: DEFAULT_CATALOG_FILTER,
  jobsViewed: {},
  jobsSaved: {},
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      drafts: { ...DEFAULT_PREFS.drafts, ...(parsed.drafts ?? {}) },
      items: parsed.items ?? {},
      jobFilter: { ...DEFAULT_JOB_FILTER, ...(parsed.jobFilter ?? {}) },
      catalogFilter: { ...DEFAULT_CATALOG_FILTER, ...(parsed.catalogFilter ?? {}) },
      jobsViewed: parsed.jobsViewed ?? {},
      jobsSaved: parsed.jobsSaved ?? {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let state: Prefs = typeof window === "undefined" ? DEFAULT_PREFS : load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(THEME_KEY, state.theme);
  } catch {
    /* storage full or disabled: keep working in memory */
  }
}

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(update: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const patch = typeof update === "function" ? update(state) : update;
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      state = load();
      listeners.forEach((l) => l());
    }
  });
}

// ------------------------------------------------------------------ item state helpers

export function updateItem(id: string, patch: Partial<ItemState>) {
  setPrefs((p) => ({ items: { ...p.items, [id]: { ...p.items[id], ...patch } } }));
}

export function markRead(ids: string[]) {
  const now = Date.now();
  setPrefs((p) => {
    const items = { ...p.items };
    for (const id of ids) if (!items[id]?.read) items[id] = { ...items[id], read: now };
    return { items };
  });
}

export function markUnread(id: string) {
  setPrefs((p) => {
    const { read: _read, ...rest } = p.items[id] ?? {};
    return { items: { ...p.items, [id]: rest } };
  });
}

// ------------------------------------------------------------------ theme

export function applyTheme(theme: Prefs["theme"]) {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// ------------------------------------------------------------------ repository detection

/** Detects "owner/repo" when served from https://<owner>.github.io/<repo>/. */
export function detectRepo(loc: Location = window.location): string {
  const m = loc.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return "";
  const seg = loc.pathname.split("/").filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
}

export function useRepo(): { repo: string; branch: string; detected: boolean } {
  const p = usePrefs();
  if (p.repo) return { repo: p.repo, branch: p.branch || "main", detected: false };
  return { repo: typeof window === "undefined" ? "" : detectRepo(), branch: p.branch || "main", detected: true };
}

// ------------------------------------------------------------------ job radar local state

export function markJobViewed(uid: string) {
  setPrefs((p) => (p.jobsViewed[uid] ? {} : { jobsViewed: { ...p.jobsViewed, [uid]: Date.now() } }));
}

export function toggleJobSaved(uid: string, job: Omit<SavedJob, "saved_at">) {
  setPrefs((p) => {
    const next = { ...p.jobsSaved };
    if (next[uid]) delete next[uid];
    else next[uid] = { ...job, saved_at: Date.now() };
    return { jobsSaved: next };
  });
}
