import { motion } from "framer-motion";
import {
  Archive, ArchiveRestore, CalendarClock, Circle, CircleDot, ExternalLink, Info, MapPin, Star,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useCategoryMap, useData } from "@/lib/data";
import { daysUntil, formatDateTime, formatPublished, relativeTime } from "@/lib/format";
import { CHANGE_LABEL, LEVEL_META } from "@/lib/labels";
import { markRead, markUnread, updateItem, usePrefs } from "@/lib/prefs";
import type { IntelEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const FACTOR_LABEL: Record<string, string> = {
  base: "基础", priority: "优先级", credibility: "可信度", change: "变化类型", minor: "小幅修改",
  keywords: "关注关键词", alert: "提醒关键词", freshness: "新鲜度", deadline: "截止日期",
};

export function ScoreBadge({ e }: { e: IntelEvent }) {
  const meta = LEVEL_META[e.level];
  return (
    <Badge tone={meta.tone} className="tabular">
      {meta.label} · {e.score}
    </Badge>
  );
}

function DeadlineChip({ deadline }: { deadline: string }) {
  const { tz } = useData();
  const d = daysUntil(deadline, tz);
  const tone = d < 0 ? "muted" : d <= 7 ? "danger" : d <= 14 ? "warning" : "neutral";
  return (
    <Badge tone={tone}>
      <CalendarClock className="size-3" />
      截止 {deadline}
      {d >= 0 ? ` · ${d === 0 ? "今天" : `${d} 天后`}` : " · 已过"}
    </Badge>
  );
}

export function EventDetail({ e, open, onOpenChange }: { e: IntelEvent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tz } = useData();
  const cats = useCategoryMap();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={e.title} className="max-w-2xl"
      description={`${e.source_name} · ${cats.get(e.category)?.name ?? e.category} · ${CHANGE_LABEL[e.change_type]}`}
      footer={
        <Button asChild variant="accent" size="sm">
          <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead([e.id])}>
            查看原文 <ExternalLink />
          </a>
        </Button>
      }
    >
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">首次发现</dt><dd className="tabular">{formatDateTime(e.detected_at, tz)}</dd>
        <dt className="text-muted-foreground">来源发布</dt>
        <dd className="tabular">{formatPublished(e.published_at, e.extra.date_only === "true", tz)}
          {!e.published_at && <span className="text-muted-foreground">（不会用检测时间代替）</span>}
        </dd>
        {e.source_updated_at && (<><dt className="text-muted-foreground">来源更新</dt><dd className="tabular">{formatDateTime(e.source_updated_at, tz)}</dd></>)}
        {e.deadline && (<><dt className="text-muted-foreground">截止日期</dt><dd><DeadlineChip deadline={e.deadline} /></dd></>)}
        {Object.entries(e.extra).filter(([k]) => !["date_only", "minor"].includes(k)).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted-foreground">{k === "location" ? "地点" : k === "tag" ? "版本标签" : k === "prerelease" ? "预发布" : k}</dt><dd>{v}</dd></div>
        ))}
        <dt className="text-muted-foreground">原始链接</dt>
        <dd className="break-all"><a className="text-accent hover:underline" href={e.url} target="_blank" rel="noopener noreferrer">{e.url}</a></dd>
      </dl>

      {e.summary && <p className="mt-4 whitespace-pre-line rounded-lg bg-muted/60 p-3 text-[13px] leading-relaxed">{e.summary}</p>}

      {e.diff && (e.diff.added.length > 0 || e.diff.removed.length > 0) && (
        <div className="mt-4">
          <h4 className="mb-2 text-[13px] font-semibold">内容差异</h4>
          <div className="overflow-hidden rounded-lg border border-border font-mono text-[12px] leading-relaxed">
            {e.diff.removed.map((l, i) => <div key={`r${i}`} className="bg-danger/8 px-3 py-0.5 text-danger"><span className="select-none opacity-60">− </span>{l}</div>)}
            {e.diff.added.map((l, i) => <div key={`a${i}`} className="bg-success/8 px-3 py-0.5 text-success"><span className="select-none opacity-60">+ </span>{l}</div>)}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-[13px] font-semibold">评分依据 <span className="font-normal text-muted-foreground">· 总分 {e.score}</span></h4>
          <ScoreBadge e={e} />
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {e.score_factors.map((f, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="w-20 shrink-0 text-muted-foreground">{FACTOR_LABEL[f.factor] ?? f.factor}</span>
              <span className="min-w-0 flex-1">{f.reason}</span>
              <span className={cn("tabular w-10 text-right font-medium", f.points > 0 ? "text-success" : f.points < 0 ? "text-danger" : "text-muted-foreground")}>
                {f.points > 0 ? `+${f.points}` : f.points}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">评分由可解释的规则计算，仅用于辅助筛选和排序，不代表客观的重要性判断。</p>
      </div>
    </Dialog>
  );
}

export function EventCard({ e, compact = false }: { e: IntelEvent; compact?: boolean }) {
  const { tz } = useData();
  const cats = useCategoryMap();
  const { items } = usePrefs();
  const st = items[e.id] ?? {};
  const [open, setOpen] = useState(false);
  const cat = cats.get(e.category);
  const keywords = [...new Set([...e.alert_keywords, ...e.matched_keywords])];

  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-foreground/15",
        st.read && "bg-card/60",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          className="mt-1 shrink-0 text-accent"
          aria-label={st.read ? "标记为未读" : "标记为已读"}
          onClick={() => (st.read ? markUnread(e.id) : markRead([e.id]))}
          title={st.read ? "标记为未读" : "标记为已读"}
        >
          {st.read ? <Circle className="size-2.5 text-border" /> : <CircleDot className="size-2.5 fill-accent" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <ScoreBadge e={e} />
            <Badge tone={e.change_type === "added" ? "success" : e.change_type === "removed" ? "muted" : "neutral"}>
              {CHANGE_LABEL[e.change_type]}{e.extra.minor === "true" ? "（小幅）" : ""}
            </Badge>
            {cat && (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ background: cat.color }} />
                {cat.name}
              </span>
            )}
            {e.deadline && <DeadlineChip deadline={e.deadline} />}
          </div>
          <h3 className={cn("text-[15px] font-semibold leading-snug tracking-tight", st.read && "font-medium text-foreground/75")}>
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent" onClick={() => markRead([e.id])}>
              {e.title}
            </a>
          </h3>
          {!compact && e.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{e.summary}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground/70">{e.source_name}</span>
            <Tooltip content={`首次发现：${formatDateTime(e.detected_at, tz)}`}>
              <span className="tabular">发现于 {relativeTime(e.detected_at)}</span>
            </Tooltip>
            <span className="tabular">{e.published_at ? `发布 ${formatPublished(e.published_at, e.extra.date_only === "true", tz)}` : "发布日期未知"}</span>
            {e.extra.location && <span className="inline-flex items-center gap-0.5"><MapPin className="size-3" />{e.extra.location}</span>}
            {!compact && keywords.slice(0, 4).map((k) => (
              <span key={k} className="rounded bg-accent-soft px-1.5 py-px text-[11px] text-accent">#{k}</span>
            ))}
          </div>
        </div>
        <div className={cn("flex shrink-0 items-center gap-0.5", !compact && "sm:opacity-60 sm:group-hover:opacity-100 transition-opacity")}>
          <Tooltip content={st.starred ? "取消收藏" : "收藏"}>
            <Button variant="ghost" size="icon-sm" aria-label={st.starred ? "取消收藏" : "收藏"} onClick={() => updateItem(e.id, { starred: !st.starred })}>
              <Star className={cn(st.starred && "fill-warning text-warning")} />
            </Button>
          </Tooltip>
          {!compact && (
            <Tooltip content={st.archived ? "移出归档" : "归档"}>
              <Button variant="ghost" size="icon-sm" aria-label={st.archived ? "移出归档" : "归档"}
                onClick={() => updateItem(e.id, { archived: !st.archived, read: st.read ?? Date.now() })}>
                {st.archived ? <ArchiveRestore /> : <Archive />}
              </Button>
            </Tooltip>
          )}
          <Tooltip content="详情与评分依据">
            <Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => setOpen(true)}><Info /></Button>
          </Tooltip>
        </div>
      </div>
      {open && <EventDetail e={e} open={open} onOpenChange={setOpen} />}
    </motion.article>
  );
}
