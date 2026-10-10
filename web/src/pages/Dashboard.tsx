import {
  Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, Flame, Inbox, Radar, Sparkles,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { EventCard } from "@/components/EventCard";
import { NotRunYet, StatCard, StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { useCategoryMap, useData } from "@/lib/data";
import { dayKey, formatDateTime, hoursSince, relativeTime } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { categoryDistribution, dailyCounts, failingSources, successRate, successRateOverDays, upcomingDeadlines } from "@/lib/stats";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function TrendChart({ rows }: { rows: ReturnType<typeof dailyCounts> }) {
  const total = rows.reduce((s, r) => s + r.changes, 0);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div>
          <CardTitle>最近 7 天新增情报</CardTitle>
          <CardDescription>按首次发现日期统计（不含建立基线时的首次收录）</CardDescription>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular">{total}</div>
          <div className="text-[11.5px] text-muted-foreground">7 日合计</div>
        </div>
      </CardHeader>
      <CardContent className="h-56 pl-1">
        {total === 0 ? (
          <div className="grid h-full place-items-center text-[13px] text-muted-foreground">最近 7 天没有检测到新的变化</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows.map((r) => ({ ...r, label: r.day.slice(5) }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="g-changes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <RTooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                formatter={(v: number, name: string) => [v, name === "changes" ? "新增情报" : "其中重要"]}
              />
              <Area type="monotone" dataKey="changes" stroke="var(--accent)" strokeWidth={2} fill="url(#g-changes)" />
              <Area type="monotone" dataKey="high" stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4 3" fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryChart() {
  const { data } = useData();
  const cats = useCategoryMap();
  const { items } = usePrefs();
  const dist = useMemo(
    () => categoryDistribution(data.events.filter((e) => !items[e.id]?.archived)),
    [data.events, items],
  );
  const total = dist.reduce((s, d) => s + d.count, 0);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>分类分布</CardTitle>
          <CardDescription>当前情报（不含已归档）</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="grid h-44 place-items-center text-[13px] text-muted-foreground">暂无情报</div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative size-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dist} dataKey="count" nameKey="category" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none">
                    {dist.map((d) => <Cell key={d.category} fill={cats.get(d.category)?.color ?? "#94a3b8"} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div><div className="text-lg font-semibold tabular">{total}</div><div className="text-[10.5px] text-muted-foreground">条</div></div>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 text-[13px]">
              {dist.map((d) => (
                <li key={d.category}>
                  <Link to={`/feed?category=${d.category}&view=inbox`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: cats.get(d.category)?.color ?? "#94a3b8" }} />
                    <span className="truncate">{cats.get(d.category)?.name ?? d.category}</span>
                    <span className="ml-auto tabular text-muted-foreground">{d.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, loading, tz } = useData();
  const { items } = usePrefs();
  const now = new Date();

  const stats = useMemo(() => {
    const today = dayKey(now, tz);
    const todays = data.events.filter((e) => dayKey(e.detected_at, tz) === today);
    const sources = data.sources?.sources ?? [];
    return {
      todayChanges: todays.filter((e) => e.change_type !== "initial").length,
      todayBaseline: todays.filter((e) => e.change_type === "initial").length,
      enabled: sources.filter((s) => s.enabled !== false).length,
      total: sources.length,
      important: data.events.filter((e) => e.level === "high" && e.change_type !== "initial" && !items[e.id]?.archived && !items[e.id]?.read).length,
      trend: dailyCounts(data.events, tz, 7, now),
      deadlines: upcomingDeadlines(data.events.filter((e) => !items[e.id]?.archived), tz, 30, now).slice(0, 5),
      failing: failingSources(data.status),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tz, items]);

  if (loading && !data.loadedAt) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const lastRun = data.status?.last_run ?? null;
  const lastSuccess = data.status?.last_successful_run_at ?? null;
  const staleHours = hoursSince(lastRun?.finished_at);
  const rateLast = successRate(lastRun);
  const rate7 = successRateOverDays(data.runs, 7, now);
  const latest = data.events.filter((e) => !items[e.id]?.archived).slice(0, 6);
  const nameOf = (id: string) => data.sources?.sources.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="情报驾驶舱"
        description={lastRun ? `最近一次监控：${formatDateTime(lastRun.finished_at, tz)}（${relativeTime(lastRun.finished_at)}）· 时区 ${tz}` : "重要的变化，值得被看见。"}
        actions={<Button asChild variant="outline" size="sm"><Link to="/feed?view=unread">查看未读情报 <ArrowRight /></Link></Button>}
      />

      {data.errors.length > 0 && (
        <Callout tone="danger" icon={AlertTriangle} title="部分数据文件读取失败" className="mb-4">
          {data.errors.join("；")}
        </Callout>
      )}

      {!data.status ? (
        <NotRunYet />
      ) : (
        <div className="space-y-4">
          {staleHours !== null && staleHours > 36 && (
            <Callout tone="warning" icon={Clock} title={`距离上次监控已超过 ${Math.floor(staleHours)} 小时`}>
              定时任务可能被 GitHub 暂停（仓库 60 天无活动时会自动停用定时工作流）或运行失败，请到 Actions 页面检查。
            </Callout>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="今日新发现" icon={Sparkles} tone="accent" value={stats.todayChanges}
              sub={stats.todayBaseline ? `另有 ${stats.todayBaseline} 条首次收录` : "按配置时区统计“今天”"} />
            <StatCard label="未读重要情报" icon={Flame} tone="danger" value={stats.important} delay={0.03}
              sub={<Link className="hover:text-accent" to="/feed?level=high&view=unread">查看 →</Link>} />
            <StatCard label="正在监控" icon={Radar} value={stats.enabled} delay={0.06}
              sub={`共 ${stats.total} 个信息源${stats.total - stats.enabled ? `，${stats.total - stats.enabled} 个暂停` : ""}`} />
            <StatCard label="监控成功率" icon={rateLast === 1 ? CheckCircle2 : Activity} tone={rateLast === 1 ? "success" : rateLast !== null && rateLast < 0.5 ? "danger" : "warning"}
              value={pct(rateLast)} delay={0.09}
              sub={<>最近一次 · 7 日平均 {pct(rate7)}<br />最后成功：{lastSuccess ? relativeTime(lastSuccess) : "从未"}</>} />
          </div>

          {stats.failing.length > 0 && (
            <Card className="border-danger/25">
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-danger" /> 监控异常</CardTitle>
                  <CardDescription>失败的来源不会删除历史数据；修复后会从上次成功的快照继续比较。</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm"><Link to="/sources?status=failing">全部 <ArrowRight /></Link></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.failing.slice(0, 4).map((s) => (
                  <div key={s.id} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <div className="flex items-center gap-2"><StatusBadge status={s.status} /><span className="text-[13px] font-medium">{nameOf(s.id)}</span></div>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground" title={s.message}>{s.message}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">连续 {s.consecutive_failures} 次 · 上次成功 {relativeTime(s.last_success_at)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <TrendChart rows={stats.trend} />
            <CategoryChart />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div><CardTitle>最新情报</CardTitle><CardDescription>按首次发现时间倒序</CardDescription></div>
                <Button asChild variant="ghost" size="sm"><Link to="/feed">情报中心 <ArrowRight /></Link></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {latest.length === 0 ? (
                  <EmptyState icon={Inbox} title="还没有情报" description="监控已运行，但尚未发现符合规则的内容。新信息源首次检查时只建立基线。" className="py-8" />
                ) : (
                  <ol className="relative space-y-2 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
                    {latest.map((e) => (
                      <li key={e.id} className="relative pl-5">
                        <span className="absolute left-0 top-5 size-[11px] rounded-full border-2 border-card bg-accent/70" />
                        <EventCard e={e} compact />
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-accent" /> 即将截止</CardTitle>
                  <CardDescription>30 天内，仅统计来源明确写出的截止日期</CardDescription></div>
              </CardHeader>
              <CardContent>
                {stats.deadlines.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">暂无即将截止的机会</p>
                ) : (
                  <ul className="space-y-2">
                    {stats.deadlines.map(({ event, days }) => (
                      <li key={event.id}>
                        <a href={event.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted">
                          <div className="w-12 shrink-0 rounded-lg border border-border bg-surface py-1 text-center">
                            <div className="text-base font-semibold leading-none tabular">{days}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">天</div>
                          </div>
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-[13px] font-medium leading-snug">{event.title}</div>
                            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{event.source_name} · 截止 {event.deadline}</div>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {lastRun && (
            <p className="text-center text-[12px] text-muted-foreground">
              最近一次运行检查了 {lastRun.sources_total} 个来源：成功 {lastRun.sources_ok}，失败 {lastRun.sources_failed}，暂停 {lastRun.sources_paused}；
              生成 {lastRun.new_events} 条情报，过滤 {lastRun.filtered} 条，去重 {lastRun.duplicates} 条。
              <Badge tone="muted" className="ml-2">{({ schedule: "定时触发", workflow_dispatch: "手动触发", manual: "本地运行" } as Record<string, string>)[lastRun.trigger] ?? lastRun.trigger}</Badge>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
