import {
  AlertTriangle, ArrowLeft, Building2, CircleDot, ExternalLink, FilterX, Info, Loader2, MapPin, SearchX,
  SlidersHorizontal, Sparkles, Star,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { NotRunYet, StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Callout, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DEFAULT_CATALOG_FILTER, activeFilterCount, countBy, filterRows, recentlyAdded, sortRows, useCatalog,
  type CatalogFilter, type CatalogSort, type CompanyEntry, type JobRow,
} from "@/lib/catalog";
import { useData } from "@/lib/data";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { EDUCATION_LEVELS, JOB_TYPES } from "@/lib/jobs";
import { NOT_PROVIDED } from "@/lib/labels";
import { markJobViewed, setPrefs, toggleJobSaved, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const PAGE = 50;

// ------------------------------------------------------------------ small pieces

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3 shadow-card">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function BarList({ rows, onPick, active }: { rows: [string, number][]; onPick?: (k: string) => void; active?: string }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="space-y-1.5">
      {rows.map(([k, n]) => (
        <li key={k}>
          <button disabled={!onPick} onClick={() => onPick?.(active === k ? "" : k)}
            className={cn("group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-[12.5px]",
              onPick && "hover:bg-muted", active === k && "ring-1 ring-accent")}>
            <span className="absolute inset-y-0 left-0 rounded-md bg-accent/10" style={{ width: `${(n / max) * 100}%` }} />
            <span className="relative min-w-0 flex-1 truncate">{k}</span>
            <span className="relative tabular text-muted-foreground">{n}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Value({ v }: { v?: string }) {
  return <span className={cn(!v && "text-muted-foreground/60")}>{v || NOT_PROVIDED}</span>;
}

function JobItem({ j, saved, viewed, tz }: { j: JobRow; saved: boolean; viewed: boolean; tz: string }) {
  const place = j.city || j.location;
  const open = () => markJobViewed(j.uid);
  return (
    <article className={cn("rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-foreground/15", viewed && "bg-card/60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {!viewed && <CircleDot className="size-2.5 fill-accent text-accent" aria-label="未查看" />}
            {j.job_type ? (
              <Tooltip content={`依据：${j.job_type_rule ?? "来源文字"}`}><span><Badge tone="accent">{j.job_type}</Badge></span></Tooltip>
            ) : <Badge tone="muted">招聘类型未提供</Badge>}
            {(j.function ?? "").split("、").filter(Boolean).map((f) => <Badge key={f} tone="info">{f}</Badge>)}
            {!j.baseline && <Badge tone="success">新收录</Badge>}
            {j.unconfirmed && (
              <Tooltip content="最近一次抓取不完整，无法确认该岗位是否仍在招聘">
                <span><Badge tone="warning">未确认在招</Badge></span>
              </Tooltip>
            )}
          </div>
          <h3 className={cn("mt-1.5 text-[15px] font-semibold leading-snug tracking-tight", viewed && "font-medium text-foreground/75")}>
            <a href={j.url} target="_blank" rel="noopener noreferrer" onClick={open} className="hover:text-accent">{j.title}</a>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{j.companyName}{j.company && j.company !== j.companyName ? ` · ${j.company}` : ""}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{place || `地点${NOT_PROVIDED}`}{j.region && place && !place.includes(j.region) ? ` · ${j.region}` : ""}</span>
            {j.department && <span>{j.department}</span>}
          </div>
          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
            <div><dt className="text-muted-foreground">学历要求</dt><dd><Value v={j.education} /></dd></div>
            <div><dt className="text-muted-foreground">毕业届别</dt><dd><Value v={j.grad_year ? `${j.grad_year} 届` : undefined} /></dd></div>
            <div><dt className="text-muted-foreground">发布时间</dt><dd className="tabular"><Value v={j.published_at ? formatDate(j.published_at, j.date_only ? "UTC" : tz) : undefined} /></dd></div>
            <div><dt className="text-muted-foreground">首次收录</dt><dd className="tabular" title={formatDateTime(j.first_seen, tz)}>{j.baseline ? "建库时已在招" : relativeTime(j.first_seen)}</dd></div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Tooltip content={saved ? "取消收藏" : "收藏（保存在本浏览器）"}>
            <Button variant="ghost" size="icon-sm" aria-label={saved ? "取消收藏" : "收藏"}
              onClick={() => toggleJobSaved(j.uid, { title: j.title, url: j.url, company: j.companyName, location: place })}>
              <Star className={cn(saved && "fill-warning text-warning")} />
            </Button>
          </Tooltip>
          <Button asChild variant="outline" size="xs">
            <a href={j.url} target="_blank" rel="noopener noreferrer" onClick={open}>申请 <ExternalLink /></a>
          </Button>
        </div>
      </div>
    </article>
  );
}

function CompanyCard({ c, onOpen }: { c: CompanyEntry; onOpen: () => void }) {
  const { data, tz } = useData();
  const st = data.status?.sources[c.source_id];
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{c.company}</h3>
          <div className="text-[12px] text-muted-foreground">{c.industry || `行业${NOT_PROVIDED}`}</div>
        </div>
        {st && <StatusBadge status={st.status} />}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular tracking-tight">{c.count}</span>
        <span className="text-[12.5px] text-muted-foreground">个在招岗位</span>
        {c.complete === false && (
          <Tooltip content={`来源报告 ${c.total_reported ?? "?"} 个，本次未能完整获取；未确认的旧岗位已保留`}>
            <span><Badge tone="warning">数据不完整</Badge></span>
          </Tooltip>
        )}
      </div>
      <dl className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">
        <div>最近检查：<span className="tabular">{st?.last_checked_at ? formatDateTime(st.last_checked_at, tz) : "尚未检查"}</span></div>
        <div className="truncate" title={c.channel}>来源：{c.channel}</div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onOpen} disabled={!c.count}>查看岗位</Button>
        <Button asChild size="sm" variant="ghost"><a href={c.careers_url} target="_blank" rel="noopener noreferrer">招聘官网 <ExternalLink /></a></Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ filters

function Filters({ f, set, opts, companies }: {
  f: CatalogFilter; set: (p: Partial<CatalogFilter>) => void; companies: CompanyEntry[];
  opts: { regions: string[]; cities: string[]; functions: string[]; years: string[] };
}) {
  return (
    <div className="space-y-3">
      <Field label="关键词"><Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="岗位名称、部门、地点…" /></Field>
      <Field label="企业">
        <Select value={f.companies[0] ?? ""} onChange={(e) => set({ companies: e.target.value ? [e.target.value] : [] })}>
          <option value="">全部企业</option>
          {companies.map((c) => <option key={c.source_id} value={c.source_id}>{c.company}（{c.count}）</option>)}
        </Select>
      </Field>
      <Field label="岗位职能">
        <Select value={f.func} onChange={(e) => set({ func: e.target.value })}>
          <option value="">全部职能</option>
          {opts.functions.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="省份 / 地区">
          <Input list="job-regions" value={f.region} onChange={(e) => set({ region: e.target.value })} placeholder="如 Jiangsu" />
          <datalist id="job-regions">{opts.regions.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="城市">
          <Input list="job-cities2" value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="如 Suzhou" />
          <datalist id="job-cities2">{opts.cities.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="招聘类型">
          <Select value={f.jobType} onChange={(e) => set({ jobType: e.target.value })}>
            <option value="">不限</option>{JOB_TYPES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="学历">
          <Select value={f.education} onChange={(e) => set({ education: e.target.value })}>
            <option value="">不限</option>{EDUCATION_LEVELS.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="毕业年份">
          <Select value={f.gradYear} onChange={(e) => set({ gradYear: e.target.value })}>
            <option value="">不限</option>{opts.years.map((y) => <option key={y} value={y}>{y} 届</option>)}
          </Select>
        </Field>
        <Field label="发布时间">
          <Select value={f.publishedWithinDays} onChange={(e) => set({ publishedWithinDays: Number(e.target.value) })}>
            <option value={0}>不限</option><option value={3}>3 天内</option><option value={7}>7 天内</option><option value={30}>30 天内</option>
          </Select>
        </Field>
        <Field label="最新收录" className="col-span-2">
          <Select value={f.firstSeenWithinDays} onChange={(e) => set({ firstSeenWithinDays: Number(e.target.value) })}>
            <option value={0}>不限</option><option value={1}>24 小时内新收录</option><option value={7}>7 天内新收录</option><option value={30}>30 天内新收录</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[12.5px]">
        <span><span className="font-medium">包含未注明该条件的岗位</span><br /><span className="text-muted-foreground">多数职位不写届别、学历；关闭后只看明确符合的</span></span>
        <Switch checked={f.includeUnknown} onCheckedChange={(v) => set({ includeUnknown: v })} aria-label="包含未注明条件的岗位" />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[12.5px]">
        <span><span className="font-medium">只看新收录</span><br /><span className="text-muted-foreground">排除建库时就已在招的岗位</span></span>
        <Switch checked={f.onlyNew} onCheckedChange={(v) => set({ onlyNew: v })} aria-label="只看新收录" />
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function Jobs() {
  const { data, loading, tz } = useData();
  const cat = useCatalog();
  const { catalogFilter: f, jobsSaved, jobsViewed } = usePrefs();
  const [tab, setTab] = useState<"jobs" | "companies">("jobs");
  const [sort, setSort] = useState<CatalogSort>("published");
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState(false);
  const set = (p: Partial<CatalogFilter>) => { setPrefs((prev) => ({ catalogFilter: { ...prev.catalogFilter, ...p } })); setLimit(PAGE); };

  const companies = useMemo(() => [...(cat.index?.companies ?? [])].sort((a, b) => b.count - a.count), [cat.index]);
  const opts = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return {
      regions: countBy(cat.rows, (j) => j.region).map(([k]) => k),
      cities: countBy(cat.rows, (j) => j.city).map(([k]) => k),
      functions: [...new Set([...(data.rules?.job_functions ?? []), ...countBy(cat.rows, (j) => j.function, true).map(([k]) => k)])],
      // Rolling range plus whatever postings state — never a fixed cohort.
      years: [...new Set([...countBy(cat.rows, (j) => j.grad_year, true).map(([k]) => k),
        ...Array.from({ length: 5 }, (_, i) => String(thisYear - 1 + i))])].sort(),
    };
  }, [cat.rows, data.rules]);

  const local = { saved: jobsSaved, viewed: jobsViewed };
  const results = useMemo(() => sortRows(filterRows(cat.rows, f, local), sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat.rows, f, sort, jobsSaved, jobsViewed]);
  const recent = useMemo(() => recentlyAdded(cat.rows, 7), [cat.rows]);
  const unviewed = useMemo(() => cat.rows.filter((j) => !jobsViewed[j.uid]).length, [cat.rows, jobsViewed]);
  const savedGone = f.view === "saved" ? Object.entries(jobsSaved).filter(([uid]) => !cat.rows.some((j) => j.uid === uid)) : [];
  const active = activeFilterCount(f);
  const incomplete = companies.filter((c) => c.complete === false);
  const selectedCompany = f.companies.length === 1 ? companies.find((c) => c.source_id === f.companies[0]) : undefined;

  if ((loading && !data.loadedAt) || cat.loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在载入岗位库… {cat.loaded ? `已载入 ${cat.loaded} 家企业` : ""}</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      </div>
    );
  }
  if (!data.status) return <div><PageHeader title="招聘雷达" /><NotRunYet /></div>;

  return (
    <div>
      <PageHeader title="招聘雷达"
        description="当前在招岗位库：来自企业官方公开招聘接口的全部在招职位，每天更新。字段只来自来源原文，未注明的显示“未提供”。"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "jobs", label: "岗位" }, { value: "companies", label: `企业 ${companies.length}` }]} />}
      />

      {!cat.index ? (
        <EmptyState icon={Building2} title="岗位库尚未建立" description="招聘来源完成下一次检查后，这里会显示全部在招岗位。" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="监控企业" value={companies.length} hint={`${companies.filter((c) => c.count).length} 家有在招岗位`} />
            <Stat label="当前在招岗位" value={cat.rows.length.toLocaleString()} hint={incomplete.length ? `${incomplete.length} 家数据不完整` : "全部来源数据完整"} />
            <Stat label="近 7 天新收录" value={recent.length} hint="不含建库时已在招的岗位" />
            <Stat label="未查看" value={unviewed.toLocaleString()} hint={`已收藏 ${Object.keys(jobsSaved).length} 个`} />
          </div>
          {cat.errors.length > 0 && <Callout tone="danger" icon={AlertTriangle} className="mb-4" title="部分企业岗位文件载入失败">{cat.errors.join("；")}</Callout>}

          {tab === "companies" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {companies.map((c) => (
                <CompanyCard key={c.source_id} c={c} onOpen={() => { set({ ...DEFAULT_CATALOG_FILTER, includeUnknown: f.includeUnknown, companies: [c.source_id] }); setTab("jobs"); }} />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="hidden space-y-4 lg:block">
                <Card className="p-4"><Filters f={f} set={set} opts={opts} companies={companies} /></Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-[13.5px]">城市分布</CardTitle></CardHeader>
                  <CardContent><BarList rows={countBy(results, (j) => j.city).slice(0, 10)} onPick={(k) => set({ city: k })} active={f.city} /></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-[13.5px]">岗位类型</CardTitle></CardHeader>
                  <CardContent><BarList rows={countBy(results, (j) => j.job_type ?? "未提供")} /></CardContent>
                </Card>
              </aside>

              <section className="min-w-0">
                {selectedCompany && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
                    <Button variant="ghost" size="icon-sm" aria-label="返回全部企业" onClick={() => set({ companies: [] })}><ArrowLeft /></Button>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{selectedCompany.company}</div>
                      <div className="text-[12px] text-muted-foreground">{selectedCompany.industry} · {selectedCompany.count} 个在招 · {selectedCompany.channel}</div>
                    </div>
                    <Button asChild size="sm" variant="outline"><a href={selectedCompany.careers_url} target="_blank" rel="noopener noreferrer">招聘官网 <ExternalLink /></a></Button>
                  </div>
                )}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Segmented value={f.view} onChange={(v) => set({ view: v })}
                    options={[{ value: "all", label: "全部" }, { value: "unviewed", label: "未查看" }, { value: "saved", label: `收藏 ${Object.keys(jobsSaved).length}` }]} />
                  <Select className="h-8 w-auto text-[13px]" value={sort} onChange={(e) => setSort(e.target.value as CatalogSort)} aria-label="排序">
                    <option value="published">按发布时间</option>
                    <option value="first_seen">按收录时间</option>
                    <option value="company">按企业</option>
                  </Select>
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheet(true)}><SlidersHorizontal /> 筛选{active ? ` · ${active}` : ""}</Button>
                  <span className="ml-auto text-[12.5px] text-muted-foreground tabular">{results.length.toLocaleString()} 个岗位</span>
                  {active > 0 && <Button variant="ghost" size="xs" onClick={() => set({ ...DEFAULT_CATALOG_FILTER, includeUnknown: f.includeUnknown, view: f.view })}><FilterX /> 清除</Button>}
                </div>

                {recent.length > 0 && f.view === "all" && !active && (
                  <Card className="mb-3">
                    <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-[13.5px]"><Sparkles className="size-4 text-accent" />最近新增岗位</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="divide-y divide-border text-[13px]">
                        {recent.slice(0, 5).map((j) => (
                          <li key={j.uid} className="flex items-center gap-2 py-1.5">
                            <a className="min-w-0 flex-1 truncate font-medium hover:text-accent" href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => markJobViewed(j.uid)}>{j.title}</a>
                            <span className="shrink-0 text-[12px] text-muted-foreground">{j.companyName} · {relativeTime(j.first_seen)}</span>
                          </li>
                        ))}
                      </ul>
                      {recent.length > 5 && <Button variant="link" size="sm" className="mt-1" onClick={() => set({ firstSeenWithinDays: 7 })}>查看全部 {recent.length} 个</Button>}
                    </CardContent>
                  </Card>
                )}
                {incomplete.length > 0 && !f.companies.length && (
                  <Callout tone="warning" icon={Info} className="mb-3">
                    {incomplete.map((c) => c.company).join("、")} 的最近一次抓取不完整（来源岗位数多于本次获取数），未确认的旧岗位已保留并标注“未确认在招”。
                  </Callout>
                )}

                {results.length === 0 && savedGone.length === 0 ? (
                  <EmptyState icon={SearchX} title={f.view === "saved" ? "还没有收藏岗位" : "没有符合条件的岗位"}
                    description={f.view === "saved" ? "点击岗位右侧的星标即可收藏，收藏保存在本浏览器。" : "试试放宽条件，或打开“包含未注明该条件的岗位”。"} />
                ) : (
                  <div className="space-y-2.5">
                    {results.slice(0, limit).map((j) => <JobItem key={j.uid} j={j} saved={!!jobsSaved[j.uid]} viewed={!!jobsViewed[j.uid]} tz={tz} />)}
                    {savedGone.map(([uid, s]) => (
                      <article key={uid} className="rounded-xl border border-dashed border-border p-4 text-[13px]">
                        <div className="flex items-start justify-between gap-2">
                          <div><a className="font-medium hover:text-accent" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                            <div className="text-muted-foreground">{s.company}{s.location ? ` · ${s.location}` : ""} · 已不在当前岗位库（可能已下架）</div></div>
                          <Button variant="ghost" size="icon-sm" aria-label="取消收藏" onClick={() => toggleJobSaved(uid, s)}><Star className="fill-warning text-warning" /></Button>
                        </div>
                      </article>
                    ))}
                    {results.length > limit && (
                      <div className="pt-2 text-center">
                        <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>加载更多（还有 {(results.length - limit).toLocaleString()} 个）</Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}

      <Dialog open={sheet} onOpenChange={setSheet} title="筛选岗位" description="条件只保存在当前浏览器。" className="max-w-xl"
        footer={<Button variant="accent" onClick={() => setSheet(false)}>查看 {results.length.toLocaleString()} 个岗位</Button>}>
        <Filters f={f} set={set} opts={opts} companies={companies} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><div className="mb-1.5 text-[13px] font-medium">城市分布</div><BarList rows={countBy(results, (j) => j.city).slice(0, 8)} onPick={(k) => set({ city: k })} active={f.city} /></div>
          <div><div className="mb-1.5 text-[13px] font-medium">岗位类型</div><BarList rows={countBy(results, (j) => j.job_type ?? "未提供")} /></div>
        </div>
      </Dialog>
    </div>
  );
}
