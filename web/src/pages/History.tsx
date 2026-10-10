import { ChevronDown, FolderClock, History as HistoryIcon, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EventCard } from "@/components/EventCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Segmented } from "@/components/ui/misc";
import { fetchJson, useData } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { IntelEvent, RunRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRIGGER: Record<string, string> = { schedule: "定时", workflow_dispatch: "手动", manual: "本地", push: "推送" };

function RunRow({ r }: { r: RunRecord }) {
  const { tz, data } = useData();
  const [open, setOpen] = useState(false);
  const checked = r.sources_total - r.sources_paused;
  const nameOf = (id: string) => data.sources?.sources.find((s) => s.id === id)?.name ?? id;
  return (
    <li className="px-4 py-3">
      <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left text-[13px]" onClick={() => setOpen(!open)} disabled={!r.errors.length} aria-expanded={open}>
        <span className="w-36 tabular font-medium">{formatDateTime(r.started_at, tz)}</span>
        <Badge tone="muted">{TRIGGER[r.trigger] ?? r.trigger}</Badge>
        <span className={cn("tabular", r.sources_failed ? "text-danger" : "text-success")}>成功 {r.sources_ok}/{checked}</span>
        <span className="tabular text-muted-foreground">新情报 {r.new_events}</span>
        <span className="tabular text-muted-foreground">过滤 {r.filtered} · 去重 {r.duplicates}</span>
        {r.errors.length > 0 && <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 rounded-lg bg-muted/50 p-3 text-[12.5px]">
          {r.errors.map((e, i) => <li key={i}><span className="font-medium">{nameOf(e.source_id)}</span>：<span className="text-muted-foreground">{e.message}</span></li>)}
        </ul>
      )}
    </li>
  );
}

function Archive() {
  const [months, setMonths] = useState<{ month: string; count: number }[] | null>(null);
  const [month, setMonth] = useState("");
  const [events, setEvents] = useState<IntelEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchJson<{ months: { month: string; count: number }[] }>("data/archive/index.json")
      .then((d) => setMonths(d?.months ?? []))
      .catch(() => setMonths([]));
  }, []);

  useEffect(() => {
    if (!month) return;
    setLoading(true);
    fetchJson<{ events: IntelEvent[] }>(`data/archive/${month}.json`)
      .then((d) => setEvents(d?.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [month]);

  if (months === null) return <div className="py-8 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></div>;
  if (months.length === 0)
    return <EmptyState icon={FolderClock} title="暂无归档月份" description="情报中心保留最近 1000 条情报；超出部分会按月份移入归档，可在这里查看。" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {months.map((m) => (
          <Button key={m.month} size="sm" variant={m.month === month ? "default" : "outline"} onClick={() => setMonth(m.month)}>
            {m.month} <span className="opacity-60">{m.count}</span>
          </Button>
        ))}
      </div>
      {loading ? <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /> : events && (
        <div className="space-y-2.5">{events.map((e) => <EventCard key={e.id} e={e} />)}</div>
      )}
    </div>
  );
}

export default function History() {
  const { data } = useData();
  const [tab, setTab] = useState<"runs" | "archive">("runs");
  return (
    <div>
      <PageHeader title="历史记录" description="每一次监控运行的结果，以及按月份归档的历史情报。监控失败时不会删除任何历史数据。"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "runs", label: "运行记录" }, { value: "archive", label: "历史情报" }]} />} />
      {tab === "runs" ? (
        <Card>
          <CardHeader><div><CardTitle>监控运行记录</CardTitle><CardDescription>保留最近 90 次被持久化的运行；点击有错误的记录可展开详情</CardDescription></div></CardHeader>
          <CardContent className="px-0 pb-0">
            {data.runs.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="还没有运行记录" description="云端监控运行一次后，这里会出现记录。" />
            ) : (
              <ul className="divide-y divide-border border-t border-border">{data.runs.map((r) => <RunRow key={r.id} r={r} />)}</ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <Archive />
      )}
    </div>
  );
}
