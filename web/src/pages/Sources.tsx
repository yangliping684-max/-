import {
  CloudOff, CloudUpload, Download, ExternalLink, FileUp, MoreHorizontal, Pause, Pencil, Play, Plus, Radar, RotateCcw,
  Trash2, Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SourceForm } from "@/components/SourceForm";
import { SyncGuide } from "@/components/SyncGuide";
import { StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Select } from "@/components/ui/input";
import { Callout, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import {
  buildExport, draftsFromImport, mergeCategories, mergeSources, pruneSyncedDrafts, validateSourcesConfig, type MergedSource,
} from "@/lib/config";
import { useData } from "@/lib/data";
import { formatDateTime, relativeTime } from "@/lib/format";
import { CREDIBILITY_LABEL, FAILURE_STATUSES, STATUS_META, TYPE_LABEL } from "@/lib/labels";
import { setPrefs, usePrefs } from "@/lib/prefs";
import type { Category, Source, SourceState, SourceStatus } from "@/lib/types";
import { cn, downloadJson, readFileText } from "@/lib/utils";

const SYNC_BADGE = {
  cloud: null,
  "draft-new": { label: "本地新增 · 未同步", tone: "warning" as const },
  "draft-modified": { label: "本地修改 · 未同步", tone: "warning" as const },
  "draft-delete": { label: "待删除 · 未同步", tone: "danger" as const },
};

function SourceRow({ m, state, categories, onEdit }: {
  m: MergedSource; state?: SourceState; categories: Map<string, Category>; onEdit: () => void;
}) {
  const { tz } = useData();
  const s = m.source;
  const prefs = usePrefs();
  const sync = SYNC_BADGE[m.sync];
  const cat = categories.get(s.category);
  // Status shown is the *cloud* status. Local drafts have never been checked by the monitor.
  const status: SourceStatus = m.sync === "draft-new" ? "pending" : s.enabled === false && m.sync === "cloud" ? "paused" : state?.status ?? "pending";

  const upsert = (src: Source) =>
    setPrefs({ drafts: { ...prefs.drafts, upserts: [...prefs.drafts.upserts.filter((x) => x.id !== src.id), src] } });
  const revert = () =>
    setPrefs({ drafts: { ...prefs.drafts, upserts: prefs.drafts.upserts.filter((x) => x.id !== s.id), deletes: prefs.drafts.deletes.filter((x) => x !== s.id) } });

  return (
    <Card className={cn("p-4 transition-colors", m.sync === "draft-delete" && "opacity-60")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("text-[15px] font-semibold tracking-tight", m.sync === "draft-delete" && "line-through")}>{s.name}</h3>
            <StatusBadge status={status} />
            {sync && <Badge tone={sync.tone}><CloudOff className="size-3" />{sync.label}</Badge>}
            {m.sync === "draft-modified" && s.enabled === false && <Badge tone="muted">草稿：暂停</Badge>}
          </div>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-muted-foreground hover:text-accent">
            <span className="truncate">{s.url}</span><ExternalLink className="size-3 shrink-0" />
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
            {cat && <Badge tone="neutral"><span className="size-1.5 rounded-full" style={{ background: cat.color }} />{cat.name}</Badge>}
            <Badge tone="muted">{TYPE_LABEL[s.type]}</Badge>
            <Badge tone="muted">优先级 {s.priority ?? 3}</Badge>
            <Badge tone="muted">{CREDIBILITY_LABEL[s.credibility ?? "unverified"]}</Badge>
            <Badge tone="muted">每天检查</Badge>
            {(s.keywords ?? []).slice(0, 5).map((k) => <span key={k} className="rounded bg-accent-soft px-1.5 py-px text-[11px] text-accent">#{k}</span>)}
            {(s.exclude_keywords ?? []).slice(0, 3).map((k) => <span key={k} className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground line-through">{k}</span>)}
            {s.require_keywords && <Badge tone="info">仅保留命中关键词</Badge>}
          </div>
          {state?.message && m.sync !== "draft-new" && (
            <p className={cn("mt-2 text-[12.5px]", FAILURE_STATUSES.includes(state.status) ? "text-danger" : "text-muted-foreground")}>{state.message}</p>
          )}
          {m.sync === "draft-new" && <p className="mt-2 text-[12.5px] text-warning">此来源只存在于当前浏览器，云端监控尚未检查过它。</p>}
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-0.5 text-[12px] md:w-[300px] md:grid-cols-1">
          {[
            ["最近检查", state?.last_checked_at],
            ["最近成功", state?.last_success_at],
            ["上次发现变化", state?.last_change_at],
          ].map(([label, v]) => (
            <div key={label} className="md:flex md:justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular"><Tooltip content={v ? formatDateTime(v, tz) : undefined}><span>{m.sync === "draft-new" ? "—" : relativeTime(v)}</span></Tooltip></dd>
            </div>
          ))}
          {state && m.sync !== "draft-new" && <div className="md:flex md:justify-between"><dt className="text-muted-foreground">条目数</dt><dd className="tabular">{state.item_count}</dd></div>}
        </dl>
        <div className="flex shrink-0 gap-1 self-start">
          <Tooltip content="编辑（保存为本地草稿）"><Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={onEdit} disabled={m.sync === "draft-delete"}><Pencil /></Button></Tooltip>
          <DropdownMenu>
            <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="更多操作"><MoreHorizontal /></Button></DropdownTrigger>
            <DropdownContent>
              {m.sync !== "draft-delete" && (
                <DropdownItem onSelect={() => upsert({ ...s, enabled: s.enabled === false })}>
                  {s.enabled === false ? <><Play /> 恢复监控（草稿）</> : <><Pause /> 暂停监控（草稿）</>}
                </DropdownItem>
              )}
              {m.sync !== "cloud" && <DropdownItem onSelect={revert}><RotateCcw /> 撤销本地更改</DropdownItem>}
              {m.sync === "cloud" || m.sync === "draft-modified" ? (
                <>
                  <DropdownSeparator />
                  <DropdownItem danger onSelect={() => setPrefs({ drafts: { ...prefs.drafts, upserts: prefs.drafts.upserts.filter((x) => x.id !== s.id), deletes: [...new Set([...prefs.drafts.deletes, s.id])] } })}>
                    <Trash2 /> 删除（草稿）
                  </DropdownItem>
                </>
              ) : null}
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

export default function Sources() {
  const { data, loading } = useData();
  const prefs = usePrefs();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Source | null | undefined>(undefined); // undefined = closed, null = new
  const [guide, setGuide] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryFilter = params.get("category") ?? "";
  const statusFilter = params.get("status") ?? "";

  // Drafts that the deployed config already contains are reported as synced and dropped.
  const drafts = useMemo(() => (data.sources ? pruneSyncedDrafts(data.sources, prefs.drafts) : prefs.drafts), [data.sources, prefs.drafts]);
  const merged = useMemo(() => mergeSources(data.sources, drafts), [data.sources, drafts]);
  const categories = useMemo(() => mergeCategories(data.sources, drafts), [data.sources, drafts]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const pending = drafts.upserts.length + drafts.deletes.length + drafts.categories.length;
  const states = data.status?.sources ?? {};

  const visible = merged.filter((m) => {
    if (categoryFilter && m.source.category !== categoryFilter) return false;
    const st = states[m.source.id]?.status ?? "pending";
    if (statusFilter === "failing") return FAILURE_STATUSES.includes(st);
    if (statusFilter) return st === statusFilter;
    return true;
  });

  const saveDraft = (s: Source, newCat?: Category) => {
    setPrefs({
      drafts: {
        ...prefs.drafts,
        upserts: [...prefs.drafts.upserts.filter((x) => x.id !== s.id), s],
        deletes: prefs.drafts.deletes.filter((x) => x !== s.id),
        categories: newCat ? [...prefs.drafts.categories.filter((c) => c.id !== newCat.id), newCat] : prefs.drafts.categories,
      },
    });
    setEditing(undefined);
    toast("已保存为本地草稿（尚未同步到云端）");
  };

  const onImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await readFileText(file));
      const res = validateSourcesConfig(parsed);
      if (!res.ok) {
        toast(`导入失败：${res.errors[0]}${res.errors.length > 1 ? ` 等 ${res.errors.length} 个问题` : ""}`, "error");
        return;
      }
      const d = draftsFromImport(data.sources, res.value!);
      setPrefs({ drafts: d });
      toast(`已导入为本地草稿：${d.upserts.length} 个新增/修改，${d.deletes.length} 个删除`);
    } catch (e) {
      toast(`导入失败：${e instanceof Error ? e.message : "无法解析 JSON"}`, "error");
    }
  };

  if (loading && !data.loadedAt) return <Skeleton className="h-96" />;

  const exportPayload = buildExport(data.sources, drafts);

  return (
    <div>
      <PageHeader
        title="我的监控"
        description="云端监控只读取仓库中的 config/sources.json。这里的新增和修改会先保存为本地草稿，导出并提交后才会生效。"
        actions={<>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
          <DropdownMenu>
            <DropdownTrigger asChild><Button variant="outline" size="sm"><Upload /> 导入 / 导出</Button></DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => downloadJson("sources.json", exportPayload)}><Download /> 导出 sources.json</DropdownItem>
              <DropdownItem onSelect={() => fileRef.current?.click()}><FileUp /> 导入 sources.json</DropdownItem>
            </DropdownContent>
          </DropdownMenu>
          <Button variant="accent" size="sm" onClick={() => setEditing(null)}><Plus /> 新增信息源</Button>
        </>}
      />

      {pending > 0 && (
        <Callout tone="warning" icon={CloudUpload} className="mb-4"
          title={`${pending} 项本地更改尚未同步到云端监控`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>这些更改只保存在当前浏览器中，GitHub Actions 看不到它们。</span>
            <Button size="xs" variant="accent" onClick={() => setGuide(true)}>如何同步</Button>
            <Button size="xs" variant="ghost" onClick={() => { setPrefs({ drafts: { upserts: [], deletes: [], categories: [] } }); toast("已丢弃全部本地草稿"); }}>丢弃全部草稿</Button>
          </div>
        </Callout>
      )}
      {!data.sources && (
        <Callout tone="danger" className="mb-4" title="未能读取已部署的 config/sources.json">请确认网站由仓库的 Pages 工作流构建；本地开发时运行 npm run dev 会自动复制配置文件。</Callout>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto" value={categoryFilter} aria-label="按类别筛选"
          onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("category", e.target.value); else p.delete("category"); setParams(p, { replace: true }); }}>
          <option value="">全部类别</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="w-auto" value={statusFilter} aria-label="按状态筛选"
          onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("status", e.target.value); else p.delete("status"); setParams(p, { replace: true }); }}>
          <option value="">全部状态</option>
          <option value="failing">异常（失败 / 需确认）</option>
          {(Object.keys(STATUS_META) as SourceStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
        <span className="ml-auto self-center text-[12.5px] text-muted-foreground tabular">{visible.length} / {merged.length} 个信息源</span>
      </div>

      {merged.length === 0 ? (
        <EmptyState icon={Radar} title="还没有信息源" description="添加第一个公开信息源，导出后提交到仓库即可开始云端监控。"
          action={<Button variant="accent" onClick={() => setEditing(null)}><Plus /> 新增信息源</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Radar} title="没有符合筛选条件的信息源" />
      ) : (
        <div className="space-y-2.5">
          {visible.map((m) => (
            <SourceRow key={m.source.id} m={m} state={states[m.source.id]} categories={catMap} onEdit={() => setEditing(m.source)} />
          ))}
        </div>
      )}

      {editing !== undefined && (
        <SourceForm open onOpenChange={(o) => !o && setEditing(undefined)} initial={editing} categories={categories}
          existingIds={new Set(merged.map((m) => m.source.id))} onSave={saveDraft} />
      )}
      <SyncGuide open={guide} onOpenChange={setGuide} file="sources.json" payload={exportPayload} />
    </div>
  );
}
