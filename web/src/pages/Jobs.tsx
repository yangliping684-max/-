import { Briefcase, FilterX, Info, SearchX, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { JobCard } from "@/components/JobCard";
import { NotRunYet } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Callout, EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useData } from "@/lib/data";
import {
  DEFAULT_JOB_FILTER, EDUCATION_LEVELS, JOB_TYPES, countActive, facetOptions, filterJobs, isJob, type JobFilter,
} from "@/lib/jobs";
import { setPrefs, usePrefs } from "@/lib/prefs";

const PAGE = 30;

function Filters({ f, set, options }: {
  f: JobFilter; set: (p: Partial<JobFilter>) => void;
  options: { years: string[]; cities: string[]; companies: string[]; industries: string[]; functions: string[] };
}) {
  const thisYear = new Date().getFullYear();
  // Offer a rolling range plus whatever the data actually contains — never a fixed cohort.
  const years = [...new Set([...options.years, ...Array.from({ length: 5 }, (_, i) => String(thisYear - 1 + i))])].sort();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="关键词" className="sm:col-span-2"><Input value={f.keyword} onChange={(e) => set({ keyword: e.target.value })} placeholder="岗位名称、职能、地点…（空格分隔）" /></Field>
      <Field label="岗位职能">
        <Select value={f.func} onChange={(e) => set({ func: e.target.value })}>
          <option value="">全部职能</option>
          {options.functions.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <Field label="招聘类型">
        <Select value={f.jobType} onChange={(e) => set({ jobType: e.target.value })}>
          <option value="">全部类型</option>
          {JOB_TYPES.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <Field label="毕业年份">
        <Select value={f.gradYear} onChange={(e) => set({ gradYear: e.target.value })}>
          <option value="">不限</option>
          {years.map((y) => <option key={y} value={y}>{y} 届</option>)}
        </Select>
      </Field>
      <Field label="学历">
        <Select value={f.education} onChange={(e) => set({ education: e.target.value })}>
          <option value="">不限</option>
          {EDUCATION_LEVELS.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <Field label="工作城市">
        <Input list="job-cities" value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="如 Shanghai / 苏州" />
        <datalist id="job-cities">{options.cities.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="发布时间">
        <Select value={f.publishedWithinDays} onChange={(e) => set({ publishedWithinDays: Number(e.target.value) })}>
          <option value={0}>不限</option>
          <option value={3}>3 天内</option>
          <option value={7}>7 天内</option>
          <option value={30}>30 天内</option>
        </Select>
      </Field>
      <Field label="公司">
        <Select value={f.company} onChange={(e) => set({ company: e.target.value })}>
          <option value="">全部公司</option>
          {options.companies.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <Field label="行业">
        <Select value={f.industry} onChange={(e) => set({ industry: e.target.value })}>
          <option value="">全部行业</option>
          {options.industries.map((x) => <option key={x}>{x}</option>)}
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[13px] sm:col-span-2">
        <span><span className="font-medium">包含未注明该条件的岗位</span><br /><span className="text-muted-foreground">很多职位不写毕业年份或学历；关闭后只显示明确符合的岗位</span></span>
        <Switch checked={f.includeUnknown} onCheckedChange={(v) => set({ includeUnknown: v })} aria-label="包含未注明条件的岗位" />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[13px] sm:col-span-2">
        <span><span className="font-medium">显示已下线的岗位</span><br /><span className="text-muted-foreground">来源列表中已移除的职位</span></span>
        <Switch checked={f.includeRemoved} onCheckedChange={(v) => set({ includeRemoved: v })} aria-label="显示已下线岗位" />
      </label>
    </div>
  );
}

export default function Jobs() {
  const { data, loading } = useData();
  const { jobFilter: f } = usePrefs();
  const [sheet, setSheet] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<"time" | "published">("time");
  const set = (p: Partial<JobFilter>) => { setPrefs((prev) => ({ jobFilter: { ...prev.jobFilter, ...p } })); setLimit(PAGE); };

  const jobSources = useMemo(
    () => (data.sources?.sources ?? []).filter((s) => s.profile === "jobs" || s.category === "jobs"),
    [data.sources],
  );
  const all = useMemo(() => {
    const ids = new Set(jobSources.map((s) => s.id));
    return data.events.filter((e) => isJob(e, ids));
  }, [data.events, jobSources]);
  const options = useMemo(() => ({
    years: facetOptions(all, "grad_year", true),
    cities: facetOptions(all, "city"),
    companies: [...new Set([...facetOptions(all, "company"), ...jobSources.map((s) => s.company).filter(Boolean) as string[]])],
    industries: [...new Set([...facetOptions(all, "industry"), ...jobSources.map((s) => s.industry).filter(Boolean) as string[]])],
    functions: [...new Set([...(data.rules?.job_functions ?? []), ...facetOptions(all, "function", true)])],
  }), [all, jobSources, data.rules]);
  const results = useMemo(() => {
    const r = filterJobs(all, f);
    const key = (e: (typeof r)[number]) => (sort === "published" ? e.published_at ?? "" : e.detected_at);
    return [...r].sort((a, b) => key(b).localeCompare(key(a)));
  }, [all, f, sort]);
  const active = countActive(f);

  if (loading && !data.loadedAt) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader title="招聘雷达" description="来自官方招聘渠道的实习、校招、管培与社招信息。所有字段均来自来源原文，未注明的显示为“未提供”。"
        actions={<>
          <Segmented value={sort} onChange={setSort} options={[{ value: "time", label: "按发现时间" }, { value: "published", label: "按发布时间" }]} />
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheet(true)}>
            <SlidersHorizontal /> 筛选{active ? ` · ${active}` : ""}
          </Button>
        </>}
      />

      {!data.status ? <NotRunYet /> : (
        <>
          <div className="mb-4 hidden rounded-xl border border-border bg-card p-4 shadow-card lg:block">
            <Filters f={f} set={set} options={options} />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span className="tabular">{results.length} / {all.length} 个岗位 · 来自 {jobSources.length} 个招聘来源</span>
            {active > 0 && <Button variant="ghost" size="xs" onClick={() => set({ ...DEFAULT_JOB_FILTER, includeUnknown: f.includeUnknown })}><FilterX /> 清除筛选</Button>}
          </div>
          <Callout tone="info" icon={Info} className="mb-4">
            筛选条件只保存在当前浏览器，不会上传。招聘性质、学历、届别仅在标题或来源字段明确写出时才会识别；只想看“确定符合”的岗位时，关闭“包含未注明该条件的岗位”。
          </Callout>

          {all.length === 0 ? (
            <EmptyState icon={Briefcase} title="还没有招聘情报" description="已配置的招聘来源完成首次检查后，岗位会出现在这里。"
              action={<Button asChild variant="outline"><Link to="/sources?category=jobs">查看招聘来源</Link></Button>} />
          ) : results.length === 0 ? (
            <EmptyState icon={SearchX} title="没有符合条件的岗位" description="试试放宽条件，或打开“包含未注明该条件的岗位”。" />
          ) : (
            <div className="space-y-2.5">
              {results.slice(0, limit).map((e) => <JobCard key={e.id} e={e} />)}
              {results.length > limit && (
                <div className="pt-2 text-center"><Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>加载更多（还有 {results.length - limit} 个）</Button></div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={sheet} onOpenChange={setSheet} title="筛选岗位" description="条件只保存在当前浏览器。" className="max-w-xl"
        footer={<Button variant="accent" onClick={() => setSheet(false)}>查看 {results.length} 个岗位</Button>}>
        <Filters f={f} set={set} options={options} />
      </Dialog>
    </div>
  );
}
