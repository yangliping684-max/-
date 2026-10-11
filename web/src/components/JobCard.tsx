import { Building2, CalendarClock, ExternalLink, Info, MapPin, Star } from "lucide-react";
import { useState } from "react";
import { EventDetail } from "@/components/EventCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { formatDateTime, formatPublished, relativeTime } from "@/lib/format";
import { NOT_PROVIDED } from "@/lib/labels";
import { markRead, updateItem, usePrefs } from "@/lib/prefs";
import type { IntelEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

function Field({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[12.5px]", !value && "text-muted-foreground/60")} title={value ? `${value}${hint ? `（${hint}）` : ""}` : "来源未提供该信息"}>
        {value || NOT_PROVIDED}
      </dd>
    </div>
  );
}

/** A job posting card. Every field shows "未提供" unless the source states it. */
export function JobCard({ e }: { e: IntelEvent }) {
  const { tz } = useData();
  const { items } = usePrefs();
  const st = items[e.id] ?? {};
  const [open, setOpen] = useState(false);
  const f = e.facets ?? {};
  const company = f.company || e.extra.company;
  const city = f.city || f.location || e.extra.location;
  const removed = e.change_type === "removed";

  return (
    <article className={cn("rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-foreground/15", removed && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-[15px] font-semibold text-foreground/70">
          {(company || e.source_name).replace(/^(博世 )/, "").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.job_type ? (
              <Tooltip content={`依据：${f.job_type_rule ?? "来源文字"}`}><span><Badge tone="accent">{f.job_type}</Badge></span></Tooltip>
            ) : (
              <Badge tone="muted">招聘性质未提供</Badge>
            )}
            {removed && <Badge tone="muted">已从来源移除</Badge>}
            {e.change_type === "initial" && <Badge tone="neutral">首次收录</Badge>}
            {(f.function ?? "").split("、").filter(Boolean).map((fn) => <Badge key={fn} tone="info">{fn}</Badge>)}
            {!st.read && <span className="size-1.5 rounded-full bg-accent" aria-label="未读" />}
          </div>
          <h3 className={cn("mt-1.5 text-[15px] font-semibold leading-snug tracking-tight", st.read && "font-medium text-foreground/75")}>
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent" onClick={() => markRead([e.id])}>{e.title}</a>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{company || e.source_name}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{city || `地点${NOT_PROVIDED}`}</span>
            {e.deadline && <span className="inline-flex items-center gap-1 text-danger"><CalendarClock className="size-3.5" />截止 {e.deadline}</span>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/50 px-3 py-2.5 sm:grid-cols-4">
            <Field label="学历要求" value={f.education} />
            <Field label="毕业届别" value={f.grad_year ? `${f.grad_year} 届` : undefined} />
            <Field label="发布时间" value={e.published_at ? formatPublished(e.published_at, e.extra.date_only === "true", tz) : undefined} />
            <Field label="行业" value={f.industry} />
          </dl>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <Tooltip content={`首次发现：${formatDateTime(e.detected_at, tz)}`}>
              <span>首次发现 {relativeTime(e.detected_at)} · {e.source_name}</span>
            </Tooltip>
            <div className="flex items-center gap-0.5">
              <Tooltip content={st.starred ? "取消收藏" : "收藏"}>
                <Button variant="ghost" size="icon-sm" aria-label={st.starred ? "取消收藏" : "收藏"} onClick={() => updateItem(e.id, { starred: !st.starred })}>
                  <Star className={cn(st.starred && "fill-warning text-warning")} />
                </Button>
              </Tooltip>
              <Tooltip content="详情与评分依据">
                <Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => setOpen(true)}><Info /></Button>
              </Tooltip>
              <Button asChild variant="outline" size="xs">
                <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead([e.id])}>申请入口 <ExternalLink /></a>
              </Button>
            </div>
          </div>
        </div>
      </div>
      {open && <EventDetail e={e} open={open} onOpenChange={setOpen} />}
    </article>
  );
}
