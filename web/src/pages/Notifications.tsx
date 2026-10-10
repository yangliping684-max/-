import { AlertTriangle, Bell, BellRing, CheckCheck, FileText, Info } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Segmented } from "@/components/ui/misc";
import { useData } from "@/lib/data";
import { formatDateTime, relativeTime } from "@/lib/format";
import { LEVEL_META } from "@/lib/labels";
import { setPrefs, usePrefs } from "@/lib/prefs";
import type { NotificationItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Renders the small markdown subset the engine generates (headings, list items, bold, links). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else out.push(<a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{m[2]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ md }: { md: string }) {
  const lines = md.split("\n");
  return (
    <div className="space-y-1 text-[13px] leading-relaxed">
      {lines.map((l, i) => {
        if (l.startsWith("# ")) return null; // title is shown separately
        if (l.startsWith("- ")) return <div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground">•</span><span>{inline(l.slice(2))}</span></div>;
        if (!l.trim()) return <Fragment key={i} />;
        return <p key={i}>{inline(l)}</p>;
      })}
    </div>
  );
}

const KIND = {
  alert: { label: "提醒", icon: BellRing, tone: "accent" as const },
  digest: { label: "每日摘要", icon: FileText, tone: "info" as const },
  system: { label: "系统", icon: AlertTriangle, tone: "warning" as const },
};

function NotificationCard({ n, unread }: { n: NotificationItem; unread: boolean }) {
  const { tz } = useData();
  const [open, setOpen] = useState(unread && n.kind !== "digest");
  const k = KIND[n.kind];
  const Icon = k.icon;
  return (
    <Card className={cn("p-4", unread && "border-accent/30")}>
      <div className="flex items-start gap-3">
        <div className={cn("grid size-9 shrink-0 place-items-center rounded-xl", n.kind === "alert" ? "bg-accent-soft text-accent" : n.kind === "digest" ? "bg-info/10 text-info" : "bg-warning/10 text-warning")}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={k.tone}>{k.label}</Badge>
            {n.kind !== "system" && <Badge tone={LEVEL_META[n.level].tone}>最高 {LEVEL_META[n.level].label}</Badge>}
            {unread && <span className="size-2 rounded-full bg-accent" aria-label="未读" />}
            <span className="ml-auto text-[12px] text-muted-foreground tabular" title={formatDateTime(n.created_at, tz)}>{relativeTime(n.created_at)}</span>
          </div>
          <h3 className="mt-1.5 text-[14.5px] font-semibold tracking-tight">{n.title}</h3>
          {n.body && (
            open ? (
              <div className="mt-2">
                {n.kind === "system" && /^https:\/\//.test(n.body)
                  ? <a href={n.body} target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent hover:underline">{n.body}</a>
                  : <MiniMarkdown md={n.body} />}
              </div>
            ) : (
              <button className="mt-1 text-[12.5px] text-accent hover:underline" onClick={() => setOpen(true)}>展开内容</button>
            )
          )}
          {n.event_ids.length > 0 && n.kind === "alert" && (
            <Button asChild variant="link" size="sm" className="mt-2"><Link to={`/feed?view=all&sort=score`}>在情报中心查看</Link></Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Notifications() {
  const { data } = useData();
  const { notificationsSeenAt } = usePrefs();
  const [seenAtOpen] = useState(notificationsSeenAt); // keep "unread" highlighting for this visit
  const [kind, setKind] = useState<"all" | NotificationItem["kind"]>("all");
  const list = useMemo(() => data.notifications.filter((n) => kind === "all" || n.kind === kind), [data.notifications, kind]);
  const unread = data.notifications.filter((n) => Date.parse(n.created_at) > notificationsSeenAt).length;

  return (
    <div>
      <PageHeader title="通知中心" description="由云端监控在每次运行后生成：达到阈值的提醒、每日摘要和信息源异常。同一事件不会重复提醒。"
        actions={unread > 0 && <Button variant="outline" size="sm" onClick={() => setPrefs({ notificationsSeenAt: Date.now() })}><CheckCheck /> 全部标为已读（{unread}）</Button>} />
      <Callout tone="info" icon={Info} className="mb-4">
        站内通知在你打开网站时查看。若希望主动收到消息，可在“情报规则”中启用 GitHub Issues 通知（GitHub 会按你的账号设置发送邮件）。邮件、Telegram 等渠道属于后续版本，尚未实现。
      </Callout>
      <Segmented value={kind} onChange={setKind} className="mb-4"
        options={[{ value: "all", label: "全部" }, { value: "alert", label: "提醒" }, { value: "digest", label: "每日摘要" }, { value: "system", label: "系统" }]} />
      {list.length === 0 ? (
        <EmptyState icon={Bell} title="暂无通知" description="当监控发现达到提醒条件的变化，或信息源出现异常时，会在这里通知你。" />
      ) : (
        <div className="space-y-2.5">{list.map((n) => <NotificationCard key={n.id} n={n} unread={Date.parse(n.created_at) > seenAtOpen} />)}</div>
      )}
    </div>
  );
}
