import { Database, Download, ExternalLink, Github, Globe, KeyRound, Laptop, Lock, Moon, PlayCircle, Sun, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { PageHeader, Segmented } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { githubWorkflowUrl } from "@/lib/config";
import { useData } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { applyTheme, DEFAULT_PREFS, detectRepo, getPrefs, setPrefs, usePrefs, useRepo } from "@/lib/prefs";
import { downloadJson, readFileText } from "@/lib/utils";

const DATA_CLASSES = [
  { icon: Globe, title: "公共监控配置", where: "仓库 config/*.json", desc: "监控哪些来源、关键词与提醒规则。公开可见，由你提交到仓库。" },
  { icon: Database, title: "公共情报数据", where: "仓库 data/*.json", desc: "由 GitHub Actions 写入的检查状态、情报、通知与快照。公开可见。" },
  { icon: Laptop, title: "浏览器本地偏好", where: "本浏览器 localStorage", desc: "已读/收藏/归档、主题、未同步的草稿。不会上传，换设备不会同步。" },
  { icon: KeyRound, title: "私密信息与凭据", where: "GitHub Actions Secrets", desc: "第一版仅使用 Actions 自动提供的 GITHUB_TOKEN；永远不会出现在前端或仓库中。" },
];

export default function Settings() {
  const prefs = usePrefs();
  const { data, tz } = useData();
  const { repo, detected } = useRepo();
  const [repoInput, setRepoInput] = useState(prefs.repo);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wf = githubWorkflowUrl(repo);
  const counts = Object.values(prefs.items).reduce(
    (c, s) => ({ read: c.read + (s.read ? 1 : 0), starred: c.starred + (s.starred ? 1 : 0), archived: c.archived + (s.archived ? 1 : 0) }),
    { read: 0, starred: 0, archived: 0 },
  );

  return (
    <div>
      <PageHeader title="系统设置" description="外观、仓库连接、手动运行监控以及本地数据管理。" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>外观</CardTitle><CardDescription>仅影响当前浏览器</CardDescription></div></CardHeader>
          <CardContent>
            <Segmented value={prefs.theme} onChange={(theme) => { setPrefs({ theme }); applyTheme(theme); }}
              options={[{ value: "light", label: <span className="inline-flex items-center gap-1"><Sun className="size-3.5" />浅色</span> },
                { value: "dark", label: <span className="inline-flex items-center gap-1"><Moon className="size-3.5" />深色</span> },
                { value: "system", label: <span className="inline-flex items-center gap-1"><Laptop className="size-3.5" />跟随系统</span> }]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle className="flex items-center gap-2"><Github className="size-4" /> GitHub 仓库</CardTitle>
            <CardDescription>用于生成“编辑配置”和“运行工作流”的直达链接</CardDescription></div></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Field label="owner/repo" className="flex-1" hint={detected && repo ? `已从网址自动识别：${repo}` : !repo ? "未能自动识别（不是 *.github.io 地址）" : undefined}>
                <Input value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder={detectRepo() || "yourname/changeradar"} />
              </Field>
              <Field label="分支" className="w-28"><Input value={prefs.branch} onChange={(e) => setPrefs({ branch: e.target.value.trim() || "main" })} /></Field>
            </div>
            <Button size="sm" variant="outline" onClick={() => {
              const v = repoInput.trim();
              if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) { toast("格式应为 owner/repo", "error"); return; }
              setPrefs({ repo: v }); toast(v ? "已保存" : "已改为自动识别");
            }}>保存</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle className="flex items-center gap-2"><PlayCircle className="size-4" /> 手动执行监控</CardTitle>
            <CardDescription>网页无法直接触发监控（那需要把 GitHub 令牌放进浏览器）。请在 GitHub Actions 中运行 Monitor 工作流。</CardDescription></div></CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>打开 Actions → Monitor 工作流</li>
              <li>点击 “Run workflow”，可选填只检查某些来源 ID</li>
              <li>约 1-3 分钟后网站自动重新部署，点击右上角刷新按钮重新载入数据</li>
            </ol>
            {wf ? <Button asChild size="sm" variant="accent"><a href={wf} target="_blank" rel="noopener noreferrer">打开 Monitor 工作流 <ExternalLink /></a></Button>
              : <p className="text-warning">请先在上方填写仓库。</p>}
            <p className="text-muted-foreground">本地也可运行：<code className="rounded bg-muted px-1 font-mono text-[12px]">python -m changeradar run</code></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>数据状态</CardTitle><CardDescription>当前页面载入的已发布数据</CardDescription></div></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">数据载入时间</dt><dd className="tabular">{data.loadedAt ? formatDateTime(data.loadedAt.toISOString(), tz) : "—"}</dd>
              <dt className="text-muted-foreground">最近一次监控</dt><dd className="tabular">{formatDateTime(data.status?.last_run?.finished_at, tz)}</dd>
              <dt className="text-muted-foreground">最近成功监控</dt><dd className="tabular">{formatDateTime(data.status?.last_successful_run_at, tz)}</dd>
              <dt className="text-muted-foreground">情报条数</dt><dd className="tabular">{data.events.length}</dd>
              <dt className="text-muted-foreground">显示时区</dt><dd>{tz}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><div><CardTitle className="flex items-center gap-2"><Lock className="size-4" /> 数据与隐私</CardTitle>
          <CardDescription>知更明确区分四类数据。仓库是公开的：请不要把个人隐私写进配置。需要私密监控时应使用私有仓库（注意私有仓库的 Pages 需要付费计划）或其他后端存储——第一版不提供私密同步能力。</CardDescription></div></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {DATA_CLASSES.map(({ icon: Icon, title, where, desc }) => (
            <div key={title} className="flex gap-3 rounded-xl border border-border p-3.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="text-[13px]"><div className="flex flex-wrap items-center gap-2 font-medium">{title}<Badge tone="muted">{where}</Badge></div><p className="mt-1 text-muted-foreground">{desc}</p></div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><div><CardTitle>本地数据</CardTitle>
          <CardDescription>已读 {counts.read} · 收藏 {counts.starred} · 归档 {counts.archived} · 来源草稿 {prefs.drafts.upserts.length + prefs.drafts.deletes.length}{prefs.rulesDraft ? " · 规则草稿 1" : ""}</CardDescription></div></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            try {
              const parsed = JSON.parse(await readFileText(f));
              if (parsed?.kind !== "changeradar-local-prefs" || typeof parsed.prefs !== "object") throw new Error("不是知更本地数据备份文件");
              setPrefs({ ...DEFAULT_PREFS, ...parsed.prefs });
              applyTheme(getPrefs().theme);
              toast("已恢复本地数据");
            } catch (err) { toast(err instanceof Error ? err.message : "导入失败", "error"); }
          }} />
          <Button variant="outline" size="sm" onClick={() => downloadJson(`changeradar-local-${new Date().toISOString().slice(0, 10)}.json`, { kind: "changeradar-local-prefs", exported_at: new Date().toISOString(), prefs: getPrefs() })}>
            <Download /> 备份本地数据
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload /> 从备份恢复</Button>
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmClear(true)}><Trash2 /> 清除本地数据</Button>
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-[12px] text-muted-foreground">知更 ChangeRadar v0.3 · Stay Informed. Stay Ahead. · 重要的变化，值得被看见。</p>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear} title="清除本地数据？"
        description="将删除本浏览器中的已读/收藏/归档状态、主题和所有未同步的草稿。云端配置和情报数据不受影响。此操作不可撤销。"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>取消</Button>
          <Button variant="danger" onClick={() => { setPrefs(DEFAULT_PREFS); applyTheme("system"); setConfirmClear(false); toast("本地数据已清除"); }}>确认清除</Button>
        </>}>
        <span />
      </Dialog>
    </div>
  );
}
