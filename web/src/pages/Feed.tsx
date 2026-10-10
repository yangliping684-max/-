import { AnimatePresence } from "framer-motion";
import { CheckCheck, FilterX, Inbox, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EventCard } from "@/components/EventCard";
import { NotRunYet } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useData } from "@/lib/data";
import { DEFAULT_FILTER, filterEvents, filterFromParams, filterToParams, type FeedFilter, type FeedView } from "@/lib/feed";
import { CHANGE_LABEL, LEVEL_META } from "@/lib/labels";
import { markRead, usePrefs } from "@/lib/prefs";

const PAGE = 40;

export default function Feed() {
  const { data, loading } = useData();
  const { items } = usePrefs();
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const [limit, setLimit] = useState(PAGE);

  const set = (patch: Partial<FeedFilter>) => {
    setParams(filterToParams({ ...filter, ...patch }), { replace: true });
    setLimit(PAGE);
  };

  const results = useMemo(() => filterEvents(data.events, filter, items), [data.events, filter, items]);
  const counts = useMemo(() => {
    const c = { inbox: 0, unread: 0, starred: 0, archived: 0, all: data.events.length };
    for (const e of data.events) {
      const s = items[e.id] ?? {};
      if (!s.archived) c.inbox++;
      if (!s.archived && !s.read) c.unread++;
      if (s.starred) c.starred++;
      if (s.archived) c.archived++;
    }
    return c;
  }, [data.events, items]);

  const sources = data.sources?.sources ?? [];
  const categories = data.sources?.categories ?? [];
  const hasFilters = filter.q || filter.category || filter.source || filter.level || filter.change || !filter.includeBaseline;
  const unreadInView = results.filter((e) => !items[e.id]?.read);

  if (loading && !data.loadedAt) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader
        title="情报中心"
        description="所有来源发现的变化统一汇总在这里。已读、收藏、归档状态只保存在当前浏览器。"
        actions={unreadInView.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => { markRead(unreadInView.map((e) => e.id)); toast(`已将 ${unreadInView.length} 条标为已读`); }}>
            <CheckCheck /> 当前列表全部已读
          </Button>
        )}
      />

      {!data.status && data.events.length === 0 ? (
        <NotRunYet />
      ) : (
        <>
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented<FeedView>
                value={filter.view}
                onChange={(v) => set({ view: v })}
                options={[
                  { value: "inbox", label: `收件箱 ${counts.inbox}` },
                  { value: "unread", label: `未读 ${counts.unread}` },
                  { value: "starred", label: `收藏 ${counts.starred}` },
                  { value: "archived", label: `归档 ${counts.archived}` },
                  { value: "all", label: "全部" },
                ]}
                className="max-w-full overflow-x-auto"
              />
              <Segmented value={filter.sort} onChange={(v) => set({ sort: v })}
                options={[{ value: "time", label: "按时间" }, { value: "score", label: "按重要程度" }]} />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
              <Input className="col-span-2 md:col-span-1" placeholder="关键词搜索（空格分隔多个词）" value={filter.q}
                onChange={(e) => set({ q: e.target.value })} aria-label="关键词搜索" />
              <Select value={filter.category} onChange={(e) => set({ category: e.target.value })} aria-label="类别">
                <option value="">全部类别</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select value={filter.source} onChange={(e) => set({ source: e.target.value })} aria-label="来源">
                <option value="">全部来源</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Select value={filter.level} onChange={(e) => set({ level: e.target.value as FeedFilter["level"] })} aria-label="重要程度">
                <option value="">全部重要程度</option>
                {(["high", "medium", "low"] as const).map((l) => <option key={l} value={l}>{LEVEL_META[l].label}</option>)}
              </Select>
              <Select value={filter.change} onChange={(e) => set({ change: e.target.value as FeedFilter["change"] })} aria-label="变化类型">
                <option value="">全部变化类型</option>
                {(Object.keys(CHANGE_LABEL) as (keyof typeof CHANGE_LABEL)[]).map((c) => <option key={c} value={c}>{CHANGE_LABEL[c]}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
              <label className="flex items-center gap-2">
                <Switch checked={filter.includeBaseline} onCheckedChange={(v) => set({ includeBaseline: v })} aria-label="显示首次收录" />
                显示“首次收录”（新来源建立基线时已有的内容）
              </label>
              <div className="flex items-center gap-3">
                <span className="tabular">{results.length} 条结果</span>
                {hasFilters && (
                  <Button variant="ghost" size="xs" onClick={() => { setParams(filterToParams({ ...DEFAULT_FILTER, view: filter.view, sort: filter.sort })); }}>
                    <FilterX /> 清除筛选
                  </Button>
                )}
              </div>
            </div>
          </div>

          {results.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={SearchX} title="没有匹配的情报" description="试试更少的关键词，或清除筛选条件。" />
            ) : (
              <EmptyState icon={Inbox} title={filter.view === "unread" ? "全部读完了" : filter.view === "starred" ? "还没有收藏" : filter.view === "archived" ? "归档为空" : "暂无情报"}
                description={filter.view === "inbox" || filter.view === "all" ? "监控运行后发现的新变化会出现在这里。" : undefined} />
            )
          ) : (
            <div className="space-y-2.5">
              <AnimatePresence initial={false}>
                {results.slice(0, limit).map((e) => <EventCard key={e.id} e={e} />)}
              </AnimatePresence>
              {results.length > limit && (
                <div className="pt-2 text-center">
                  <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>加载更多（还有 {results.length - limit} 条）</Button>
                </div>
              )}
            </div>
          )}
          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            情报中心显示最近 1000 条；更早的情报在“历史记录”中按月份查看。
          </p>
        </>
      )}
    </div>
  );
}
