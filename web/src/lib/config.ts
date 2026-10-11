// Validation, draft merging and sync status for sources.json / rules.json.
// The validation mirrors the engine's Pydantic models so an exported file is accepted
// by the monitor as-is. The engine remains the final authority (`changeradar validate`).

import type { Category, RulesConfig, Source, SourcesConfig, SourceType } from "./types";
import type { SourceDrafts } from "./prefs";
import { jsonEqual } from "./utils";

export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TYPES: SourceType[] = ["rss", "api", "github_releases", "html"];
const CREDIBILITY = ["official", "reliable", "unverified", "low"];
const LEVELS = ["high", "medium", "low"];

const SOURCE_KEYS = new Set([
  "id", "name", "type", "url", "category", "enabled", "keywords", "exclude_keywords", "require_keywords",
  "priority", "credibility", "frequency", "max_items", "baseline_items", "track_removals", "ignore_patterns",
  "html", "api", "notes", "profile", "company", "industry", "careers_url", "channel", "ats",
]);
const PROFILES = ["general", "jobs", "ai", "pricing", "status"];

export function validateSource(s: unknown, categoryIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["信息源必须是对象"];
  const o = s as Record<string, unknown>;
  const label = typeof o.id === "string" ? o.id : "(无 id)";
  for (const k of Object.keys(o)) if (!SOURCE_KEYS.has(k)) errs.push(`${label}: 未知字段 "${k}"`);
  if (typeof o.id !== "string" || !SOURCE_ID_RE.test(o.id))
    errs.push(`${label}: id 只能包含小写字母、数字和连字符，长度 2-64`);
  if (typeof o.name !== "string" || !o.name.trim()) errs.push(`${label}: 缺少名称`);
  const ats = o.ats as Record<string, unknown> | undefined | null;
  if (ats) {
    if (!["smartrecruiters", "greenhouse", "lever"].includes(ats.provider as string)) errs.push(`${label}: 招聘系统只支持 SmartRecruiters / Greenhouse / Lever`);
    if (typeof ats.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(ats.id)) errs.push(`${label}: 招聘系统中的企业标识只能包含字母、数字、点、下划线和连字符`);
    if (ats.country != null && (typeof ats.country !== "string" || !/^[a-z]{2}$/i.test(ats.country))) errs.push(`${label}: 国家代码应为两位字母，如 cn`);
  } else {
    if (!TYPES.includes(o.type as SourceType)) errs.push(`${label}: 类型必须是 ${TYPES.join(" / ")}`);
    if (typeof o.url !== "string" || !/^https?:\/\//.test(o.url)) errs.push(`${label}: url 必须以 http(s):// 开头`);
  }
  if (o.careers_url !== undefined && (typeof o.careers_url !== "string" || !/^https?:\/\//.test(o.careers_url)))
    errs.push(`${label}: 招聘官网地址必须以 http(s):// 开头`);
  if (typeof o.category !== "string" || !categoryIds.has(o.category))
    errs.push(`${label}: 分类 "${String(o.category)}" 不存在`);
  if (o.priority !== undefined && !(Number.isInteger(o.priority) && (o.priority as number) >= 1 && (o.priority as number) <= 5))
    errs.push(`${label}: 优先级必须是 1-5 的整数`);
  if (o.credibility !== undefined && !CREDIBILITY.includes(o.credibility as string))
    errs.push(`${label}: 可信度取值无效`);
  if (o.profile !== undefined && !PROFILES.includes(o.profile as string)) errs.push(`${label}: 模块类型取值无效`);
  if (o.profile === "pricing" && o.type !== "html") errs.push(`${label}: 定价页监控只支持网页类型`);
  if (o.frequency !== undefined && o.frequency !== "daily") errs.push(`${label}: 第一版仅支持每天检查（daily）`);
  for (const k of ["keywords", "exclude_keywords", "ignore_patterns"]) {
    if (o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === "string")))
      errs.push(`${label}: ${k} 必须是字符串数组`);
  }
  if (Array.isArray(o.ignore_patterns)) {
    for (const p of o.ignore_patterns as string[]) {
      try {
        new RegExp(p);
      } catch {
        errs.push(`${label}: 无效的正则 ${p}`);
      }
    }
  }
  if (o.type === "html") {
    const h = o.html as Record<string, unknown> | undefined;
    if (!h || typeof h.selector !== "string" || !h.selector.trim()) errs.push(`${label}: 网页类型必须提供 html.selector`);
  }
  if (o.type === "api" && (!o.api || typeof o.api !== "object")) errs.push(`${label}: API 类型必须提供 api 字段映射`);
  if (o.type === "github_releases" && typeof o.url === "string" && !/^https:\/\/(github\.com\/[^/]+\/[^/]+|api\.github\.com\/)/.test(o.url))
    errs.push(`${label}: GitHub Releases 的地址应为 https://github.com/<owner>/<repo>`);
  return errs;
}

export interface ValidationResult<T> {
  ok: boolean;
  errors: string[];
  value?: T;
}

export function validateSourcesConfig(data: unknown): ValidationResult<SourcesConfig> {
  if (!data || typeof data !== "object") return { ok: false, errors: ["文件内容不是 JSON 对象"] };
  const o = data as Record<string, unknown>;
  const errors: string[] = [];
  if (!Array.isArray(o.categories)) errors.push("缺少 categories 数组");
  if (!Array.isArray(o.sources)) errors.push("缺少 sources 数组");
  if (errors.length) return { ok: false, errors };
  const cats = o.categories as Category[];
  const catIds = new Set<string>();
  for (const c of cats) {
    if (!c || typeof c.id !== "string" || typeof c.name !== "string") errors.push("分类必须包含 id 和 name");
    else catIds.add(c.id);
  }
  const seen = new Set<string>();
  for (const s of o.sources as unknown[]) {
    errors.push(...validateSource(s, catIds));
    const id = (s as Source)?.id;
    if (id) {
      if (seen.has(id)) errors.push(`信息源 id 重复：${id}`);
      seen.add(id);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: data as SourcesConfig };
}

export function validateRules(data: unknown): ValidationResult<RulesConfig> {
  if (!data || typeof data !== "object") return { ok: false, errors: ["文件内容不是 JSON 对象"] };
  const r = data as RulesConfig;
  const errors: string[] = [];
  const inRange = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
  if (!r.levels || !inRange(r.levels.high) || !inRange(r.levels.medium)) errors.push("levels.high / medium 必须是 0-100 的整数");
  else if (r.levels.medium > r.levels.high) errors.push("关注阈值不能高于重要阈值");
  if (!inRange(r.importance_threshold)) errors.push("提醒阈值必须是 0-100 的整数");
  if (!Array.isArray(r.alert_keywords)) errors.push("alert_keywords 必须是数组");
  try {
    new Intl.DateTimeFormat("en", { timeZone: r.timezone });
  } catch {
    errors.push(`无效的时区：${r.timezone}`);
  }
  if (!r.digest || !LEVELS.includes(r.digest.min_level)) errors.push("digest.min_level 无效");
  if (!r.github_issue || !LEVELS.includes(r.github_issue.min_level)) errors.push("github_issue.min_level 无效");
  if (r.keyword_groups !== undefined) {
    if (typeof r.keyword_groups !== "object" || Array.isArray(r.keyword_groups)) errors.push("keyword_groups 必须是对象");
    else
      for (const [k, v] of Object.entries(r.keyword_groups))
        if (!k.trim() || !Array.isArray(v) || !v.every((x) => typeof x === "string"))
          errors.push(`同义词组 "${k}" 必须是字符串数组`);
  }
  if (r.job_functions !== undefined && !(Array.isArray(r.job_functions) && r.job_functions.every((x) => typeof x === "string")))
    errors.push("job_functions 必须是字符串数组");
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value: r };
}

// ------------------------------------------------------------------ drafts & sync

export type SyncState = "cloud" | "draft-new" | "draft-modified" | "draft-delete";

export interface MergedSource {
  source: Source;
  sync: SyncState;
}

/** Drop draft entries that are already identical to the deployed cloud config. */
export function pruneSyncedDrafts(cloud: SourcesConfig | null, drafts: SourceDrafts): SourceDrafts {
  const cloudSources = new Map((cloud?.sources ?? []).map((s) => [s.id, s]));
  const cloudCats = new Map((cloud?.categories ?? []).map((c) => [c.id, c]));
  return {
    upserts: drafts.upserts.filter((s) => !jsonEqual(normalizeSource(s), normalizeSource(cloudSources.get(s.id)))),
    deletes: drafts.deletes.filter((id) => cloudSources.has(id)),
    categories: drafts.categories.filter((c) => !jsonEqual(c, cloudCats.get(c.id))),
  };
}

export function mergeSources(cloud: SourcesConfig | null, drafts: SourceDrafts): MergedSource[] {
  const out: MergedSource[] = [];
  const upserts = new Map(drafts.upserts.map((s) => [s.id, s]));
  const deletes = new Set(drafts.deletes);
  for (const s of cloud?.sources ?? []) {
    if (deletes.has(s.id)) out.push({ source: s, sync: "draft-delete" });
    else if (upserts.has(s.id)) out.push({ source: upserts.get(s.id)!, sync: "draft-modified" });
    else out.push({ source: s, sync: "cloud" });
    upserts.delete(s.id);
  }
  for (const s of upserts.values()) out.push({ source: s, sync: "draft-new" });
  return out;
}

export function mergeCategories(cloud: SourcesConfig | null, drafts: SourceDrafts): Category[] {
  const map = new Map((cloud?.categories ?? []).map((c) => [c.id, c]));
  for (const c of drafts.categories) map.set(c.id, c);
  return [...map.values()];
}

/** The full sources.json that should be committed to apply all local drafts. */
export function buildExport(cloud: SourcesConfig | null, drafts: SourceDrafts): SourcesConfig {
  const merged = mergeSources(cloud, drafts).filter((m) => m.sync !== "draft-delete").map((m) => normalizeSource(m.source)!);
  return { version: cloud?.version ?? 1, categories: mergeCategories(cloud, drafts), sources: merged };
}

/** Turn an imported config into drafts relative to the deployed cloud config. */
export function draftsFromImport(cloud: SourcesConfig | null, imported: SourcesConfig): SourceDrafts {
  const importedIds = new Set(imported.sources.map((s) => s.id));
  return pruneSyncedDrafts(cloud, {
    upserts: imported.sources,
    deletes: (cloud?.sources ?? []).map((s) => s.id).filter((id) => !importedIds.has(id)),
    categories: imported.categories,
  });
}

/** Remove empty/default-less noise so equality checks and exports are stable. */
export function normalizeSource(s: Source | undefined): Source | undefined {
  if (!s) return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0 && k !== "keywords")) continue;
    out[k] = v;
  }
  if (Array.isArray(out.keywords) && (out.keywords as unknown[]).length === 0) delete out.keywords;
  return out as unknown as Source;
}

export function githubEditUrl(repo: string, branch: string, path: string): string | null {
  return repo ? `https://github.com/${repo}/edit/${branch}/${path}` : null;
}

export function githubWorkflowUrl(repo: string, file = "monitor.yml"): string | null {
  return repo ? `https://github.com/${repo}/actions/workflows/${file}` : null;
}
