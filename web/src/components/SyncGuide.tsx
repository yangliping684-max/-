import { Copy, Download, ExternalLink, GitCommitHorizontal, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { githubEditUrl, githubWorkflowUrl } from "@/lib/config";
import { useRepo } from "@/lib/prefs";
import { copyText, downloadJson } from "@/lib/utils";

/** Explains — truthfully — how a locally edited config reaches the cloud monitor. */
export function SyncGuide({ open, onOpenChange, file, payload }: {
  open: boolean; onOpenChange: (o: boolean) => void; file: "sources.json" | "rules.json"; payload: unknown;
}) {
  const { repo, branch } = useRepo();
  const edit = githubEditUrl(repo, branch, `config/${file}`);
  const wf = githubWorkflowUrl(repo);
  const text = JSON.stringify(payload, null, 2) + "\n";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`将 ${file} 同步到云端`} className="max-w-xl"
      description="浏览器无法也不应该直接修改你的仓库（那需要把 GitHub 令牌放进前端）。请按以下步骤手动提交，提交后即对云端监控生效。">
      <ol className="space-y-4 text-[13px]">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">导出完整配置</div>
            <p className="text-muted-foreground">导出内容 = 云端当前配置 + 你的本地草稿。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={async () => { const ok = await copyText(text); toast(ok ? "已复制到剪贴板" : "复制失败，请使用下载", ok ? "success" : "error"); }}>
                <Copy /> 复制 JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadJson(file, payload)}><Download /> 下载 {file}</Button>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">在 GitHub 上替换 <code className="rounded bg-muted px-1 font-mono text-[12px]">config/{file}</code> 并提交</div>
            <p className="text-muted-foreground">打开编辑页，全选并粘贴新内容，点击 “Commit changes”。也可以在本地仓库中替换文件后 git push。</p>
            {edit ? (
              <Button asChild size="sm" variant="accent" className="mt-2"><a href={edit} target="_blank" rel="noopener noreferrer"><GitCommitHorizontal /> 在 GitHub 中编辑 <ExternalLink /></a></Button>
            ) : (
              <p className="mt-2 text-xs text-warning">未识别到仓库地址：请在“系统设置”中填写 owner/repo 以生成直达链接。</p>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">自动校验并生效</div>
            <p className="text-muted-foreground">CI 会用监控引擎校验配置；下一次定时监控（或手动运行 Monitor 工作流）开始使用新配置。网站重新部署后，这里的草稿会自动显示为“已同步”。</p>
            {wf && <Button asChild size="sm" variant="ghost" className="mt-1 -ml-2"><a href={wf} target="_blank" rel="noopener noreferrer">手动运行 Monitor 工作流 <ExternalLink /></a></Button>}
          </div>
        </li>
      </ol>
      <Callout tone="info" icon={ShieldCheck} className="mt-5">
        配置文件位于公开仓库中，任何人都能看到。不要在其中填写密码、令牌或个人隐私信息；需要凭据的功能请使用 GitHub Actions Secrets。
      </Callout>
    </Dialog>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent tabular">{n}</span>;
}
