// Loads the public JSON files produced by the monitor (data/) and the public config
// (config/). Missing files are reported as "not available", never replaced with samples.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { IntelEvent, NotificationItem, RulesConfig, RunRecord, SourcesConfig, StatusFile } from "./types";

export interface AppData {
  sources: SourcesConfig | null;
  rules: RulesConfig | null;
  status: StatusFile | null;
  events: IntelEvent[];
  eventsUpdatedAt: string | null;
  runs: RunRecord[];
  notifications: NotificationItem[];
  loadedAt: Date | null;
  errors: string[];
}

export const DEFAULT_RULES: RulesConfig = {
  version: 1,
  timezone: "Asia/Shanghai",
  levels: { high: 70, medium: 45 },
  alert_keywords: [],
  importance_threshold: 70,
  max_alerts_per_run: 20,
  digest: { enabled: true, max_items: 30, min_level: "low" },
  github_issue: { enabled: false, min_level: "high", labels: ["changeradar"], max_issues_per_day: 1 },
};

const EMPTY: AppData = {
  sources: null,
  rules: null,
  status: null,
  events: [],
  eventsUpdatedAt: null,
  runs: [],
  notifications: [],
  loadedAt: null,
  errors: [],
};

const base = import.meta.env.BASE_URL;

export async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  // Dev servers answer unknown paths with index.html; treat that as "missing".
  if (text.trimStart().startsWith("<")) return null;
  return JSON.parse(text) as T;
}

interface Ctx {
  data: AppData;
  loading: boolean;
  reload: () => Promise<void>;
  tz: string;
}

const DataContext = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const errors: string[] = [];
    const get = async <T,>(path: string): Promise<T | null> => {
      try {
        return await fetchJson<T>(path);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        return null;
      }
    };
    const [sources, rules, status, events, runs, notifications] = await Promise.all([
      get<SourcesConfig>("config/sources.json"),
      get<RulesConfig>("config/rules.json"),
      get<StatusFile>("data/status.json"),
      get<{ updated_at: string; events: IntelEvent[] }>("data/events.json"),
      get<{ runs: RunRecord[] }>("data/runs.json"),
      get<{ notifications: NotificationItem[] }>("data/notifications.json"),
    ]);
    setData({
      sources,
      rules,
      status,
      events: events?.events ?? [],
      eventsUpdatedAt: events?.updated_at ?? null,
      runs: runs?.runs ?? [],
      notifications: notifications?.notifications ?? [],
      loadedAt: new Date(),
      errors,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<Ctx>(
    () => ({ data, loading, reload, tz: data.rules?.timezone ?? DEFAULT_RULES.timezone }),
    [data, loading, reload],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): Ctx {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}

export function useCategoryMap() {
  const { data } = useData();
  return useMemo(() => new Map((data.sources?.categories ?? []).map((c) => [c.id, c])), [data.sources]);
}
