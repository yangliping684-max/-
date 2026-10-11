import { CloudUpload, Info, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SyncGuide } from "@/components/SyncGuide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Callout, PageHeader } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { validateRules } from "@/lib/config";
import { DEFAULT_RULES, useData } from "@/lib/data";
import { LEVEL_META } from "@/lib/labels";
import { setPrefs, usePrefs } from "@/lib/prefs";
import type { Level, RulesConfig } from "@/lib/types";
import { jsonEqual } from "@/lib/utils";

// Mirrors engine/changeradar/scoring.py — documentation for users, the engine is authoritative.
const SCORING_TABLE: [string, string][] = [
  ["基础分", "+20"],
  ["信息源优先级 1 / 2 / 3 / 4 / 5", "−10 / −5 / 0 / +8 / +15"],
  ["来源可信度：官方 / 可靠 / 未验证 / 低", "+10 / +5 / 0 / −10"],
  ["变化类型：新增 / 修改 / 移除 / 首次收录", "+15 / +8 / 0 / −15"],
  ["小幅修改（文字改动极少）", "−15"],
  ["命中关注关键词（每个 +8，最多）", "+16"],
  ["命中提醒关键词", "+20"],
  ["发布于 24 小时 / 3 天 / 7 天内；超过 30 天", "+15 / +10 / +5；−10"],
  ["发布日期未知", "0（不使用检测时间代替）"],
  ["截止日期 14 天内 / 更晚 / 已过", "+15 / +8 / −10"],
];

export function groupsToText(groups: Record<string, string[]> = {}): string {
  return Object.entries(groups).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
}

export function textToGroups(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const i = line.search(/[:：]/);
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const words = line.slice(i + 1).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    if (name) out[name] = [...new Set(words)];
  }
  return out;
}

function GroupsEditor({ form, set }: { form: RulesConfig; set: (p: Partial<RulesConfig>) => void }) {
  const [text, setText] = useState(groupsToText(form.keyword_groups));
  useEffect(() => setText(groupsToText(form.keyword_groups)), [form.keyword_groups]);
  const names = Object.keys(form.keyword_groups ?? {});
  const fns = new Set(form.job_functions ?? []);
  return (
    <Card className="mt-4">
      <CardHeader><div><CardTitle>同义词组</CardTitle>
        <CardDescription>在任何关键词列表里写组名，即可同时匹配组内的中英文同义词；写“实习 &amp; 采购”表示必须同时命中两组。</CardDescription></div></CardHeader>
      <CardContent className="space-y-4">
        <Textarea rows={Math.min(14, Math.max(5, names.length + 1))} className="font-mono text-[12.5px]" value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { const g = textToGroups(text); set({ keyword_groups: g, job_functions: (form.job_functions ?? []).filter((x) => x in g) }); }}
          placeholder={"供应链: supply chain, SCM\n采购: procurement, purchasing, buyer"} aria-label="同义词组" />
        <div>
          <div className="mb-1.5 text-[13px] font-medium">作为“岗位职能”标签的组</div>
          <div className="flex flex-wrap gap-1.5">
            {names.length === 0 && <span className="text-[13px] text-muted-foreground">先添加同义词组</span>}
            {names.map((n) => (
              <button key={n} onClick={() => set({ job_functions: fns.has(n) ? [...fns].filter((x) => x !== n) : [...fns, n] })}
                className={`rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors ${fns.has(n) ? "border-accent bg-accent-soft text-accent" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">选中的组会作为招聘雷达中的“岗位职能”筛选项，仅用于标注，不会单独过滤岗位。</p>
        </div>
      </CardContent>
    </Card>
  );
}

function KeywordInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText("");
  };
  return (
    <div className="rounded-lg border border-border bg-card p-2 shadow-card focus-within:border-accent/60">
      <div className="flex flex-wrap gap-1.5">
        {value.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[12.5px] text-accent">
            {k}
            <button aria-label={`移除 ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}><X className="size-3" /></button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} onBlur={add}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }}
          placeholder={value.length ? "" : "输入关键词后回车"} className="min-w-28 flex-1 bg-transparent px-1 text-sm outline-none" aria-label="添加提醒关键词" />
      </div>
    </div>
  );
}

export default function Rules() {
  const { data } = useData();
  const prefs = usePrefs();
  const cloud = data.rules ?? DEFAULT_RULES;
  const [form, setForm] = useState<RulesConfig>(prefs.rulesDraft ?? cloud);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    // Draft identical to the deployed rules → it has been synced.
    if (prefs.rulesDraft && data.rules && jsonEqual(prefs.rulesDraft, data.rules)) setPrefs({ rulesDraft: null });
  }, [prefs.rulesDraft, data.rules]);
  useEffect(() => setForm(prefs.rulesDraft ?? cloud), [prefs.rulesDraft, cloud]);

  const v = validateRules(form);
  const dirty = !jsonEqual(form, prefs.rulesDraft ?? cloud);
  const hasDraft = !!prefs.rulesDraft;
  const set = (patch: Partial<RulesConfig>) => setForm((f) => ({ ...f, ...patch }));
  const num = (s: string) => Math.max(0, Math.min(100, Math.round(Number(s) || 0)));

  return (
    <div>
      <PageHeader title="情报规则" description="决定哪些变化值得提醒。规则保存在仓库的 config/rules.json，由云端监控在每次运行时使用。"
        actions={<>
          {hasDraft && <Button variant="ghost" size="sm" onClick={() => { setPrefs({ rulesDraft: null }); toast("已撤销本地规则草稿"); }}><RotateCcw /> 撤销草稿</Button>}
          <Button variant="outline" size="sm" disabled={!v.ok || dirty} onClick={() => setGuide(true)}><CloudUpload /> 同步到云端</Button>
          <Button variant="accent" size="sm" disabled={!v.ok || !dirty} onClick={() => { setPrefs({ rulesDraft: form }); toast("已保存为本地草稿（尚未同步）"); }}><Save /> 保存草稿</Button>
        </>}
      />
      {hasDraft && <Callout tone="warning" icon={CloudUpload} className="mb-4" title="规则草稿尚未同步">当前显示的是本地草稿。云端监控仍在使用仓库中的规则，直到你提交新的 rules.json。</Callout>}
      {!data.rules && <Callout tone="info" icon={Info} className="mb-4">未找到已部署的 rules.json，显示的是引擎默认值。</Callout>}
      {!v.ok && <Callout tone="danger" className="mb-4" title="规则有误">{v.errors.join("；")}</Callout>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>提醒条件</CardTitle><CardDescription>满足任一条件的新变化会进入通知中心（首次收录不提醒）</CardDescription></div></CardHeader>
          <CardContent className="space-y-4">
            <Field label="提醒关键词" hint="对所有来源生效；命中会 +20 分并直接触发提醒">
              <KeywordInput value={form.alert_keywords} onChange={(alert_keywords) => set({ alert_keywords })} />
            </Field>
            <Field label={`重要性提醒阈值：${form.importance_threshold}`} hint="评分达到该值的变化会触发提醒">
              <input type="range" min={0} max={100} value={form.importance_threshold} className="w-full accent-[var(--accent)]"
                onChange={(e) => set({ importance_threshold: num(e.target.value) })} aria-label="重要性提醒阈值" />
            </Field>
            <Field label="单次运行最多提醒条数" hint="防止配置错误导致的提醒轰炸；同一运行的提醒会合并为一条通知">
              <Input type="number" min={1} max={200} value={form.max_alerts_per_run} onChange={(e) => set({ max_alerts_per_run: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>重要程度分级</CardTitle><CardDescription>评分（0-100）到等级的映射</CardDescription></div></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`“${LEVEL_META.high.label}”最低分`}><Input type="number" min={0} max={100} value={form.levels.high} onChange={(e) => set({ levels: { ...form.levels, high: num(e.target.value) } })} /></Field>
              <Field label={`“${LEVEL_META.medium.label}”最低分`}><Input type="number" min={0} max={100} value={form.levels.medium} onChange={(e) => set({ levels: { ...form.levels, medium: num(e.target.value) } })} /></Field>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full">
              <div className="bg-muted" style={{ width: `${form.levels.medium}%` }} title="一般" />
              <div className="bg-info/60" style={{ width: `${Math.max(0, form.levels.high - form.levels.medium)}%` }} title="关注" />
              <div className="bg-accent" style={{ width: `${100 - form.levels.high}%` }} title="重要" />
            </div>
            <Field label="时区" hint="用于判断“今天”和每日摘要日期；GitHub Actions 本身使用 UTC">
              <Input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Shanghai" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>每日摘要</CardTitle><CardDescription>每天一条，当天多次运行时原地更新而不是重复发送</CardDescription></div>
            <Switch checked={form.digest.enabled} onCheckedChange={(enabled) => set({ digest: { ...form.digest, enabled } })} aria-label="启用每日摘要" /></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="最多条数"><Input type="number" min={1} max={200} value={form.digest.max_items} disabled={!form.digest.enabled} onChange={(e) => set({ digest: { ...form.digest, max_items: Math.max(1, Math.min(200, Number(e.target.value) || 1)) } })} /></Field>
            <Field label="最低等级">
              <Select value={form.digest.min_level} disabled={!form.digest.enabled} onChange={(e) => set({ digest: { ...form.digest, min_level: e.target.value as Level } })}>
                {(["low", "medium", "high"] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_META[l].label}</option>)}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>GitHub Issues 通知 <Badge tone="muted" className="ml-1 align-middle">可选</Badge></CardTitle>
            <CardDescription>启用后，达到等级的每日摘要会以 Issue 形式发布到本仓库（GitHub 会按你的通知设置发邮件）</CardDescription></div>
            <Switch checked={form.github_issue.enabled} onCheckedChange={(enabled) => set({ github_issue: { ...form.github_issue, enabled } })} aria-label="启用 GitHub Issues 通知" /></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="最低等级">
                <Select value={form.github_issue.min_level} disabled={!form.github_issue.enabled} onChange={(e) => set({ github_issue: { ...form.github_issue, min_level: e.target.value as Level } })}>
                  {(["low", "medium", "high"] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_META[l].label}</option>)}
                </Select>
              </Field>
              <Field label="每天最多 Issue 数"><Input type="number" min={1} max={5} value={form.github_issue.max_issues_per_day} disabled={!form.github_issue.enabled}
                onChange={(e) => set({ github_issue: { ...form.github_issue, max_issues_per_day: Math.max(1, Math.min(5, Number(e.target.value) || 1)) } })} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">使用 Actions 自带的 GITHUB_TOKEN，无需额外密钥。公开仓库的 Issue 所有人可见。</p>
          </CardContent>
        </Card>
      </div>

      <GroupsEditor form={form} set={set} />

      <Card className="mt-4">
        <CardHeader><div><CardTitle>评分规则说明</CardTitle><CardDescription>每条情报的详情中都会列出实际得分明细。评分只用于辅助筛选和排序，不代表客观事实。</CardDescription></div></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {SCORING_TABLE.map(([k, v]) => (
              <li key={k} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:justify-between"><span>{k}</span><span className="tabular text-muted-foreground">{v}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">总分限制在 0-100。截止日期仅在来源文本中出现“截止 / deadline / apply by”等提示词且日期带年份时才会被识别。</p>
        </CardContent>
      </Card>

      <SyncGuide open={guide} onOpenChange={setGuide} file="rules.json" payload={prefs.rulesDraft ?? form} />
    </div>
  );
}
