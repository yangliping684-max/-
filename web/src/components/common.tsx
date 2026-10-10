import { motion } from "framer-motion";
import { ExternalLink, PlayCircle, Radar, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { githubWorkflowUrl } from "@/lib/config";
import { STATUS_META } from "@/lib/labels";
import { useRepo } from "@/lib/prefs";
import type { SourceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: SourceStatus }) {
  const m = STATUS_META[status];
  return (
    <Tooltip content={m.hint}>
      <span><Badge tone={m.tone} dot>{m.label}</Badge></span>
    </Tooltip>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone, delay = 0, children }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: LucideIcon; tone?: "accent" | "danger" | "success" | "warning";
  delay?: number; children?: ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}>
      <Card className="h-full p-4">
        <div className="flex items-center justify-between text-[12.5px] font-medium text-muted-foreground">
          {label}
          <Icon className={cn("size-4", tone === "accent" && "text-accent", tone === "danger" && "text-danger",
            tone === "success" && "text-success", tone === "warning" && "text-warning")} />
        </div>
        <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular">{value}</div>
        {sub && <div className="mt-2 text-[12px] text-muted-foreground">{sub}</div>}
        {children}
      </Card>
    </motion.div>
  );
}

/** Shown when the monitor has never produced data — explains how to start it for real. */
export function NotRunYet() {
  const { repo } = useRepo();
  const wf = githubWorkflowUrl(repo);
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
        <div className="p-6 sm:p-8">
          <div className="mb-4 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><Radar className="size-5" /></div>
          <h2 className="text-xl font-semibold tracking-tight">知更还没有运行过监控</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            这里不会显示任何示例或模拟数据。当 GitHub Actions 第一次运行监控后，真实的检查结果和情报会出现在这里。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {wf ? (
              <Button asChild variant="accent"><a href={wf} target="_blank" rel="noopener noreferrer"><PlayCircle /> 打开监控工作流</a></Button>
            ) : (
              <Badge tone="muted">在“系统设置”中填写仓库地址后可直接跳转到工作流</Badge>
            )}
          </div>
        </div>
        <ol className="space-y-4 border-t border-border bg-surface p-6 text-[13px] sm:p-8 md:border-l md:border-t-0">
          {[
            ["在仓库 Settings → Pages 中选择 “GitHub Actions” 作为来源", "用于自动部署本网站"],
            ["在 Actions 页面启用工作流", "Fork 的仓库默认禁用定时任务"],
            ["运行 “Monitor” 工作流（Run workflow）", "首次运行会为每个来源建立基线"],
            ["等待部署完成后刷新本页", "之后每天北京时间约 07:17 自动运行"],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-card text-[12px] font-semibold tabular">{i + 1}</span>
              <div><div className="font-medium">{t}</div><div className="text-muted-foreground">{d}</div></div>
            </li>
          ))}
          <li className="text-muted-foreground">
            {repo ? (
              <a className="inline-flex items-center gap-1 text-accent hover:underline" href={`https://github.com/${repo}#readme`} target="_blank" rel="noopener noreferrer">
                完整步骤见仓库 README <ExternalLink className="size-3" />
              </a>
            ) : "完整步骤见仓库 README。"}
          </li>
        </ol>
      </div>
    </Card>
  );
}
