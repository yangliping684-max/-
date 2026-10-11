import { Cpu, ExternalLink, Info, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { EventDetail } from "@/components/EventCard";
import { NotRunYet } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { formatDateTime, formatPublished, relativeTime } from "@/lib/format";
import { AI_TYPE_META, CHANGE_LABEL } from "@/lib/labels";
import { markRead, usePrefs } from "@/lib/prefs";
import type { IntelEvent } from "@/lib/types";
import { cn, plainText } from "@/lib/utils";

const TYPE_ORDER = ["new_model", "new_feature", "version", "api_change", "pricing", "status", "news"];
const PAGE = 30;

function AiCard({ e }: { e: IntelEvent }) {
  const { tz } = useData();
  const { items } = usePrefs();
  const [open, setOpen] = useState(false);
  const f = e.facets ?? {};
  const type = AI_TYPE_META[f.ai_type ?? "news"] ?? AI_TYPE_META.news;
  const vendor = f.vendor || e.source_name;
  const read = !!items[e.id]?.read;
  const isPriceChange = f.ai_type === "pricing" && e.change_type === "modified" && e.diff;

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-foreground/15">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground text-[13px] font-semibold text-background">{vendor.slice(0, 1)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <Tooltip content={f.ai_type_rule ? `分类依据：${f.ai_type_rule}` : undefined}><span><Badge tone={type.tone}>{type.label}</Badge></span></Tooltip>
            <span className="font-medium text-foreground/80">{vendor}</span>
            {e.change_type !== "added" && <Badge tone="muted">{CHANGE_LABEL[e.change_type]}</Badge>}
            {!read && <span className="size-1.5 rounded-full bg-accent" aria-label="未读" />}
          </div>
          <h3 className={cn("mt-1 text-[15px] font-semibold leading-snug tracking-tight", read && "font-medium text-foreground/75")}>
            <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent" onClick={() => markRead([e.id])}>{e.title}</a>
          </h3>
          {isPriceChange ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-border font-mono text-[12px] leading-relaxed">
              {e.diff!.removed.slice(0, 4).map((l, i) => <div key={`r${i}`} className="bg-danger/8 px-3 py-0.5 text-danger">− {l}</div>)}
              {e.diff!.added.slice(0, 4).map((l, i) => <div key={`a${i}`} className="bg-success/8 px-3 py-0.5 text-success">+ {l}</div>)}
            </div>
          ) : e.summary && f.ai_type !== "pricing" ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{plainText(e.summary)}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span>{e.source_name}</span>
            <span className="tabular">{e.published_at ? `发布 ${formatPublished(e.published_at, e.extra.date_only === "true", tz)}` : "发布日期未知"}</span>
            <Tooltip content={formatDateTime(e.detected_at, tz)}><span>发现于 {relativeTime(e.detected_at)}</span></Tooltip>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => setOpen(true)}><Info /></Button>
              <Button asChild variant="outline" size="xs"><a href={e.url} target="_blank" rel="noopener noreferrer" onClick={() => markRead([e.id])}>查看原文 <ExternalLink /></a></Button>
            </span>
          </div>
        </div>
      </div>
      {open && <EventDetail e={e} open={open} onOpenChange={setOpen} />}
    </article>
  );
}

export default function AiUpdates() {
  const { data, loading } = useData();
  const [type, setType] = useState("");
  const [vendor, setVendor] = useState("");
  const [baseline, setBaseline] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const aiSourceIds = useMemo(
    () => new Set((data.sources?.sources ?? []).filter((s) => ["ai", "pricing", "status"].includes(s.profile ?? "")).map((s) => s.id)),
    [data.sources],
  );
  const all = useMemo(() => data.events.filter((e) => aiSourceIds.has(e.source_id) || e.facets?.ai_type), [data.events, aiSourceIds]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of all) if (baseline || e.change_type !== "initial") c.set(e.facets?.ai_type ?? "news", (c.get(e.facets?.ai_type ?? "news") ?? 0) + 1);
    return c;
  }, [all, baseline]);
  const vendors = useMemo(() => [...new Set(all.map((e) => e.facets?.vendor || e.source_name))].sort(), [all]);
  const results = all.filter((e) =>
    (!type || (e.facets?.ai_type ?? "news") === type) &&
    (!vendor || (e.facets?.vendor || e.source_name) === vendor) &&
    (baseline || e.change_type !== "initial"));

  if (loading && !data.loadedAt) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader title="AI 动态" description="只来自官方渠道：新模型、新功能、版本更新、API 变更、定价与服务状态。类型由可解释的规则识别，悬停徽章可查看依据。" />
      {!data.status ? <NotRunYet /> : (
        <>
          <div className="-mx-4 mb-3 overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:px-0">
            <div className="flex w-max gap-1.5">
              <Button size="sm" variant={type === "" ? "default" : "outline"} onClick={() => { setType(""); setLimit(PAGE); }}>全部 <span className="opacity-60">{[...counts.values()].reduce((a, b) => a + b, 0)}</span></Button>
              {TYPE_ORDER.filter((t) => counts.get(t)).map((t) => (
                <Button key={t} size="sm" variant={type === t ? "default" : "outline"} onClick={() => { setType(t); setLimit(PAGE); }}>
                  {AI_TYPE_META[t].label} <span className="opacity-60">{counts.get(t)}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
            {vendors.map((v) => (
              <button key={v} onClick={() => setVendor(vendor === v ? "" : v)}
                className={cn("rounded-full border px-2.5 py-0.5 transition-colors", vendor === v ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
                {v}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-muted-foreground">
              <Switch checked={baseline} onCheckedChange={setBaseline} aria-label="显示首次收录" /> 显示首次收录
            </label>
          </div>
          <Callout tone="info" icon={Info} className="mb-4">
            定价页只在价格行真正变化时才生成“定价变化”，并显示变化前后的价格；横幅、排版或动态内容的变化不会被当作涨价或降价。首次收录的定价页只是监控基线。
          </Callout>
          {all.length === 0 ? (
            <EmptyState icon={Cpu} title="还没有 AI 动态" description="AI 来源完成首次检查后会出现在这里。" />
          ) : results.length === 0 ? (
            <EmptyState icon={SearchX} title="没有符合条件的动态" />
          ) : (
            <div className="space-y-2.5">
              {results.slice(0, limit).map((e) => <AiCard key={e.id} e={e} />)}
              {results.length > limit && <div className="pt-2 text-center"><Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>加载更多</Button></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
