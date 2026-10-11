// Mirrors engine/changeradar/models.py. Keep both in sync.

export type SourceType = "rss" | "api" | "github_releases" | "html";
export type Credibility = "official" | "reliable" | "unverified" | "low";
export type SourceStatus =
  | "pending"
  | "ok"
  | "unchanged"
  | "changed"
  | "fetch_error"
  | "parse_error"
  | "paused"
  | "blocked";
export type ChangeType = "initial" | "added" | "modified" | "removed";
export type Level = "high" | "medium" | "low";

export interface HtmlOptions {
  selector: string;
  item_selector?: string | null;
  title_selector?: string | null;
  link_selector?: string | null;
  date_selector?: string | null;
  summary_selector?: string | null;
  ignore_selectors?: string[];
}

export interface ApiPagination {
  offset_param?: string;
  page_size?: number;
  max_pages?: number;
}

export type SourceProfile = "general" | "jobs" | "ai" | "pricing" | "status";

export interface ApiOptions {
  items_path?: string;
  id_field?: string;
  title_field?: string;
  url_field?: string;
  summary_field?: string | null;
  published_field?: string | null;
  updated_field?: string | null;
  extra_fields?: Record<string, string>;
  url_template?: string | null;
  total_path?: string | null;
  pagination?: ApiPagination | null;
}

export interface Source {
  id: string;
  name: string;
  type?: SourceType;
  url?: string;
  category: string;
  enabled?: boolean;
  keywords?: string[];
  exclude_keywords?: string[];
  require_keywords?: boolean;
  priority?: number;
  credibility?: Credibility;
  frequency?: "daily";
  max_items?: number;
  baseline_items?: number;
  track_removals?: boolean | null;
  ignore_patterns?: string[];
  html?: HtmlOptions | null;
  api?: ApiOptions | null;
  notes?: string;
  profile?: SourceProfile;
  company?: string;
  industry?: string;
  careers_url?: string;
  channel?: string;
  /** v0.3: official public job-board API shortcut; engine fills type/url/api. */
  ats?: { provider: "smartrecruiters" | "greenhouse" | "lever"; id: string; country?: string | null } | null;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

export interface SourcesConfig {
  version: number;
  categories: Category[];
  sources: Source[];
}

export interface RulesConfig {
  version: number;
  timezone: string;
  levels: { high: number; medium: number };
  alert_keywords: string[];
  importance_threshold: number;
  max_alerts_per_run: number;
  digest: { enabled: boolean; max_items: number; min_level: Level };
  github_issue: { enabled: boolean; min_level: Level; labels: string[]; max_issues_per_day: number };
  keyword_groups?: Record<string, string[]>;
  job_functions?: string[];
}

export interface ScoreFactor {
  factor: string;
  points: number;
  reason: string;
}

export interface IntelEvent {
  id: string;
  source_id: string;
  source_name: string;
  category: string;
  change_type: ChangeType;
  title: string;
  url: string;
  summary: string;
  detected_at: string;
  published_at: string | null;
  source_updated_at: string | null;
  matched_keywords: string[];
  alert_keywords: string[];
  deadline: string | null;
  score: number;
  level: Level;
  score_factors: ScoreFactor[];
  diff: { added: string[]; removed: string[] } | null;
  extra: Record<string, string>;
  /** v0.2 structured facets; absent on v0.1 events. Only explicitly stated information. */
  facets?: Record<string, string>;
}

export interface SourceState {
  id: string;
  status: SourceStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_change_at: string | null;
  message: string;
  consecutive_failures: number;
  item_count: number;
  http_status: number | null;
}

export interface RunRecord {
  id: string;
  started_at: string;
  finished_at: string;
  trigger: string;
  sources_total: number;
  sources_ok: number;
  sources_failed: number;
  sources_paused: number;
  new_events: number;
  filtered: number;
  duplicates: number;
  errors: { source_id: string; status: string; message: string }[];
}

export interface StatusFile {
  generated_at: string;
  last_run: RunRecord | null;
  last_successful_run_at: string | null;
  sources: Record<string, SourceState>;
}

export interface NotificationItem {
  id: string;
  kind: "alert" | "digest" | "system";
  created_at: string;
  title: string;
  body: string;
  event_ids: string[];
  level: Level;
}
