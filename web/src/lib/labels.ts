import type { ChangeType, Credibility, Level, SourceStatus, SourceType } from "./types";

export const STATUS_META: Record<SourceStatus, { label: string; tone: Tone; hint: string }> = {
  pending: { label: "尚未检查", tone: "neutral", hint: "云端监控还没有检查过该来源" },
  ok: { label: "正常", tone: "success", hint: "已成功建立基线" },
  unchanged: { label: "内容无变化", tone: "neutral", hint: "检查成功，与上次快照一致" },
  changed: { label: "发现变化", tone: "accent", hint: "检查成功，并发现了新的变化" },
  fetch_error: { label: "请求失败", tone: "danger", hint: "网络错误、超时或服务器错误" },
  parse_error: { label: "解析失败", tone: "danger", hint: "获取成功但无法提取内容，可能页面结构已变化" },
  paused: { label: "暂停监控", tone: "muted", hint: "该来源已在配置中停用" },
  blocked: { label: "需人工确认", tone: "warning", hint: "robots.txt 禁止、需要登录或人机验证，系统不会绕过" },
};

export const FAILURE_STATUSES: SourceStatus[] = ["fetch_error", "parse_error", "blocked"];

export const CHANGE_LABEL: Record<ChangeType, string> = {
  initial: "首次收录",
  added: "新增",
  modified: "内容修改",
  removed: "已移除",
};

export const LEVEL_META: Record<Level, { label: string; tone: Tone }> = {
  high: { label: "重要", tone: "accent" },
  medium: { label: "关注", tone: "info" },
  low: { label: "一般", tone: "neutral" },
};

export const TYPE_LABEL: Record<SourceType, string> = {
  rss: "RSS / Atom",
  api: "公开 API",
  github_releases: "GitHub Releases",
  html: "网页",
};

export const CREDIBILITY_LABEL: Record<Credibility, string> = {
  official: "官方来源",
  reliable: "可靠来源",
  unverified: "未验证",
  low: "低可信度",
};

export const PROFILE_LABEL: Record<string, string> = {
  general: "通用",
  jobs: "招聘",
  ai: "AI 动态",
  pricing: "定价页",
  status: "服务状态",
};

export const AI_TYPE_META: Record<string, { label: string; tone: Tone }> = {
  new_model: { label: "新模型", tone: "accent" },
  new_feature: { label: "新功能", tone: "success" },
  version: { label: "版本更新", tone: "info" },
  api_change: { label: "API 变更", tone: "warning" },
  pricing: { label: "定价变化", tone: "danger" },
  status: { label: "服务公告", tone: "neutral" },
  news: { label: "一般新闻", tone: "muted" },
};

export const NOT_PROVIDED = "未提供";

export type Tone = "neutral" | "muted" | "accent" | "success" | "warning" | "danger" | "info";
