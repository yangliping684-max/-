// Date helpers. All engine timestamps are ISO-8601 UTC; display uses the configured
// timezone (rules.json → timezone) so "今天" means the user's day, not UTC's.

export function dayKey(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Dates parsed from page text have no time/timezone: show them as plain dates in UTC. */
export function formatPublished(iso: string | null, dateOnly: boolean, tz: string): string {
  if (!iso) return "发布日期未知";
  return dateOnly ? formatDate(iso, "UTC") : formatDateTime(iso, tz);
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "从未";
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 0) return "刚刚";
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return `${Math.floor(diff / 86400 / 30)} 个月前`;
}

export function hoursSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

/** Last N day keys (oldest first) ending today in tz. */
export function lastDays(n: number, tz: string, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86_400_000), tz));
  return out;
}

export function daysUntil(isoDate: string, tz: string, now: Date = new Date()): number {
  const today = dayKey(now, tz);
  return Math.round((Date.parse(isoDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}
