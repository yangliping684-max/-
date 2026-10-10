import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { SOURCE_ID_RE, validateSource } from "@/lib/config";
import { CREDIBILITY_LABEL, TYPE_LABEL } from "@/lib/labels";
import type { Category, Credibility, Source, SourceType } from "@/lib/types";
import { Info } from "lucide-react";

const list = (s: string) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
const join = (a?: string[]) => (a ?? []).join(", ");

/** ASCII slug from a name; non-Latin names (e.g. Chinese) get a stable hash-based id. */
export function slugify(name: string, prefix = "source"): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (s.length >= 3) return s;
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

interface FormState {
  id: string; name: string; type: SourceType; url: string; category: string; enabled: boolean;
  keywords: string; exclude: string; require: boolean; priority: number; credibility: Credibility; notes: string;
  selector: string; itemSelector: string; titleSelector: string; linkSelector: string; dateSelector: string; ignoreSelectors: string;
  itemsPath: string; idField: string; titleField: string; urlField: string; summaryField: string; publishedField: string;
}

function toForm(s: Source | null): FormState {
  return {
    id: s?.id ?? "", name: s?.name ?? "", type: s?.type ?? "rss", url: s?.url ?? "", category: s?.category ?? "custom",
    enabled: s?.enabled ?? true, keywords: join(s?.keywords), exclude: join(s?.exclude_keywords),
    require: s?.require_keywords ?? false, priority: s?.priority ?? 3, credibility: s?.credibility ?? "unverified",
    notes: s?.notes ?? "",
    selector: s?.html?.selector ?? "", itemSelector: s?.html?.item_selector ?? "", titleSelector: s?.html?.title_selector ?? "",
    linkSelector: s?.html?.link_selector ?? "", dateSelector: s?.html?.date_selector ?? "", ignoreSelectors: join(s?.html?.ignore_selectors),
    itemsPath: s?.api?.items_path ?? "", idField: s?.api?.id_field ?? "id", titleField: s?.api?.title_field ?? "title",
    urlField: s?.api?.url_field ?? "url", summaryField: s?.api?.summary_field ?? "", publishedField: s?.api?.published_field ?? "",
  };
}

function fromForm(f: FormState, original: Source | null): Source {
  // Keep advanced fields the form does not expose (max_items, ignore_patterns…).
  const base: Source = { ...(original ?? {}), id: f.id.trim(), name: f.name.trim(), type: f.type, url: f.url.trim(), category: f.category } as Source;
  base.enabled = f.enabled;
  base.keywords = list(f.keywords);
  base.exclude_keywords = list(f.exclude);
  base.require_keywords = f.require || undefined;
  base.priority = f.priority;
  base.credibility = f.credibility;
  base.notes = f.notes.trim() || undefined;
  base.html = undefined;
  base.api = undefined;
  if (f.type === "html") {
    base.html = {
      selector: f.selector.trim(),
      ...(f.itemSelector.trim() && { item_selector: f.itemSelector.trim() }),
      ...(f.titleSelector.trim() && { title_selector: f.titleSelector.trim() }),
      ...(f.linkSelector.trim() && { link_selector: f.linkSelector.trim() }),
      ...(f.dateSelector.trim() && { date_selector: f.dateSelector.trim() }),
      ...(list(f.ignoreSelectors).length && { ignore_selectors: list(f.ignoreSelectors) }),
    };
  }
  if (f.type === "api") {
    base.api = {
      ...(original?.api ?? {}),
      items_path: f.itemsPath.trim(), id_field: f.idField.trim() || "id", title_field: f.titleField.trim() || "title",
      url_field: f.urlField.trim() || "url",
      ...(f.summaryField.trim() ? { summary_field: f.summaryField.trim() } : { summary_field: undefined }),
      ...(f.publishedField.trim() ? { published_field: f.publishedField.trim() } : { published_field: undefined }),
    };
  }
  for (const k of Object.keys(base) as (keyof Source)[]) if (base[k] === undefined) delete base[k];
  return base;
}

export function SourceForm({ open, onOpenChange, initial, categories, existingIds, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: Source | null; categories: Category[];
  existingIds: Set<string>; onSave: (s: Source, newCategory?: Category) => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(initial));
  const [newCat, setNewCat] = useState("");
  const [touched, setTouched] = useState(false);
  const isNew = !initial;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const categoryOptions = useMemo(() => {
    const extra = newCat.trim() ? [{ id: "__new__", name: `＋ 新分类：${newCat.trim()}` }] : [];
    return [...categories, ...extra];
  }, [categories, newCat]);

  const candidate = fromForm({ ...f, id: f.id || slugify(f.name) }, initial);
  const newCategory: Category | undefined = f.category === "__new__" && newCat.trim()
    ? { id: slugify(newCat.trim(), "cat"), name: newCat.trim(), color: "#64748b" }
    : undefined;
  if (newCategory) candidate.category = newCategory.id;
  const catIds = new Set([...categories.map((c) => c.id), ...(newCategory ? [newCategory.id] : [])]);
  const errors = validateSource(candidate, catIds);
  if (isNew && existingIds.has(candidate.id)) errors.push(`id "${candidate.id}" 已存在`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl"
      title={isNew ? "新增信息源" : `编辑：${initial?.name}`}
      description="保存后成为本地草稿，需要导出并提交到仓库后才会被云端监控使用。"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="accent" onClick={() => { setTouched(true); if (!errors.length) onSave(candidate, newCategory); }}>保存为本地草稿</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名称"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="例如：某大学研究生院通知" /></Field>
        <Field label="ID" hint={isNew ? "留空则根据名称自动生成；只能用小写字母、数字、连字符" : "已有来源的 ID 不能修改（用于关联历史快照）"}
          error={f.id && !SOURCE_ID_RE.test(f.id) ? "格式不正确" : undefined}>
          <Input value={isNew ? f.id : initial!.id} disabled={!isNew} onChange={(e) => set("id", e.target.value)} placeholder={slugify(f.name || "my-source")} />
        </Field>
        <Field label="类型">
          <Select value={f.type} onChange={(e) => set("type", e.target.value as SourceType)}>
            {(Object.keys(TYPE_LABEL) as SourceType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="类别">
          <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
            {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="网址" className="sm:col-span-2"
          hint={f.type === "github_releases" ? "仓库地址，例如 https://github.com/owner/repo" : f.type === "api" ? "返回 JSON 的官方公开接口地址" : f.type === "rss" ? "RSS / Atom 订阅地址" : "公开网页地址（不支持需要登录的页面）"}>
          <Input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" inputMode="url" />
        </Field>
        <Field label="新增分类（可选）" hint="输入名称后在“类别”中选择它">
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="例如：政策法规" />
        </Field>
        <Field label="优先级" hint="1 最低，5 最高；影响评分">
          <Select value={f.priority} onChange={(e) => set("priority", Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="关注关键词" hint="逗号分隔；命中会提高评分" className="sm:col-span-1">
          <Input value={f.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="实习, intern, 截止" />
        </Field>
        <Field label="排除关键词" hint="命中则不生成情报">
          <Input value={f.exclude} onChange={(e) => set("exclude", e.target.value)} placeholder="广告, sponsored" />
        </Field>
        <Field label="来源可信度">
          <Select value={f.credibility} onChange={(e) => set("credibility", e.target.value as Credibility)}>
            {(Object.keys(CREDIBILITY_LABEL) as Credibility[]).map((c) => <option key={c} value={c}>{CREDIBILITY_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="检查频率" hint="第一版固定为每天一次">
          <Input value="每天一次（daily）" disabled />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:col-span-2">
          <div className="text-[13px]"><div className="font-medium">只保留命中关注关键词的条目</div><div className="text-muted-foreground">适合更新量很大的来源（如 arXiv）</div></div>
          <Switch checked={f.require} onCheckedChange={(v) => set("require", v)} aria-label="只保留命中关键词的条目" />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:col-span-2">
          <div className="text-[13px]"><div className="font-medium">启用监控</div><div className="text-muted-foreground">关闭后状态为“暂停监控”，不会发起任何请求</div></div>
          <Switch checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="启用监控" />
        </div>

        {f.type === "html" && (
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:col-span-2">
            <Callout tone="info" icon={Info}>网页监控通过 CSS 选择器定位稳定的内容区域。只填写“内容区域”会把整块区域作为一个条目逐行比较；填写“条目选择器”则逐条追踪新增与移除。</Callout>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="内容区域选择器（必填）"><Input value={f.selector} onChange={(e) => set("selector", e.target.value)} placeholder="#content, .notice-list" /></Field>
              <Field label="条目选择器"><Input value={f.itemSelector} onChange={(e) => set("itemSelector", e.target.value)} placeholder="li, .item" /></Field>
              <Field label="标题选择器"><Input value={f.titleSelector} onChange={(e) => set("titleSelector", e.target.value)} placeholder="a, .title" /></Field>
              <Field label="链接选择器"><Input value={f.linkSelector} onChange={(e) => set("linkSelector", e.target.value)} placeholder="默认取条目内第一个链接" /></Field>
              <Field label="日期选择器"><Input value={f.dateSelector} onChange={(e) => set("dateSelector", e.target.value)} placeholder=".date, time" /></Field>
              <Field label="忽略的元素" hint="逗号分隔，例如计数器、广告"><Input value={f.ignoreSelectors} onChange={(e) => set("ignoreSelectors", e.target.value)} placeholder=".views, .ad" /></Field>
            </div>
          </div>
        )}
        {f.type === "api" && (
          <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:col-span-2 sm:grid-cols-3">
            <Field label="条目列表路径" hint="例如 data.items；留空表示根节点"><Input value={f.itemsPath} onChange={(e) => set("itemsPath", e.target.value)} /></Field>
            <Field label="ID 字段"><Input value={f.idField} onChange={(e) => set("idField", e.target.value)} /></Field>
            <Field label="标题字段"><Input value={f.titleField} onChange={(e) => set("titleField", e.target.value)} /></Field>
            <Field label="链接字段"><Input value={f.urlField} onChange={(e) => set("urlField", e.target.value)} /></Field>
            <Field label="摘要字段"><Input value={f.summaryField} onChange={(e) => set("summaryField", e.target.value)} /></Field>
            <Field label="发布日期字段" hint="仅映射真正的发布日期"><Input value={f.publishedField} onChange={(e) => set("publishedField", e.target.value)} /></Field>
          </div>
        )}
        <Field label="备注" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></Field>
      </div>
      {touched && errors.length > 0 && (
        <Callout tone="danger" className="mt-4" title="请修正以下问题">
          <ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Callout>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        请只添加允许公开访问的来源。监控引擎会遵守 robots.txt，不会绕过登录、验证码、反爬虫机制或付费墙；无法访问时会标记为“需人工确认”。
      </p>
    </Dialog>
  );
}
