# 部署与排错

## 一次性设置

| 步骤 | 位置 | 设置 |
| --- | --- | --- |
| 1 | Settings → Pages | Source = **GitHub Actions** |
| 2 | Settings → Actions → General | Workflow permissions = **Read and write** |
| 3 | Actions | Fork 的仓库需点击 “I understand my workflows, go ahead and enable them” |
| 4 | Actions → Monitor | **Run workflow** 完成首次运行 |

不需要创建任何 Secret。`GITHUB_TOKEN` 由 Actions 自动注入，用于提交 `data/`、调用 GitHub API（提高速率限额）和可选的 Issue 通知。

## 三个工作流

| 文件 | 触发 | 作用 |
| --- | --- | --- |
| `ci.yml` | PR、push（忽略 `data/**`） | 校验配置、运行引擎与前端测试、构建 |
| `monitor.yml` | 每天 `17 23 * * *`（UTC）+ 手动 | 运行监控 → 按需提交 `data/` → 调用 `pages.yml` 部署 |
| `pages.yml` | 修改 `web/`、`config/` 的 push；被 monitor 调用；手动 | 构建前端（附带数据）并部署 Pages |

### 设计要点

- **UTC 时区**：GitHub cron 永远是 UTC。`23:17 UTC` = 北京时间 07:17。选择非整点分钟，减少整点排队延迟。GitHub 不保证准点，延迟数分钟到更久都属正常；“今天”的统计按 `rules.json` 的 `timezone` 计算，而不是运行时刻的 UTC 日期。
- **并发**：`concurrency: changeradar-monitor` 保证同一时间只有一个监控运行；推送前 `git pull --rebase` 并最多重试 4 次，避免与你同时提交配置时冲突（`data/` 只由监控写入，因此 rebase 不会产生数据冲突）。
- **部署触发**：用 `GITHUB_TOKEN` 推送的提交**不会**触发其他工作流，所以 monitor 通过 `workflow_call` 直接调用 `pages.yml`，并把本次运行的 `data/` 作为 artifact 传给构建，确保网站显示最新检查时间（即使本次没有提交）。
- **失败可见**：所有启用的来源都失败、或配置无效时，Monitor 运行会标红；但状态与错误信息仍会被保存并部署，网站会显示异常。

## 常见问题

**网站一直显示“尚未运行”**
Monitor 还没成功运行过，或 Pages 部署失败。查看 Actions 中最近一次 Monitor 与 Deploy Pages 的日志。

**Monitor 提交失败：`Permission to ... denied to github-actions[bot]`**
Settings → Actions → General → Workflow permissions 改为 Read and write。

**Deploy 失败：`Branch "xxx" is not allowed to deploy to github-pages`**
Settings → Environments → github-pages → Deployment branches，允许默认分支。

**定时任务不再运行**
仓库 60 天没有活动时 GitHub 会自动停用定时工作流。在 Actions 页面重新启用即可；网站在超过 36 小时没有新运行时会显示警告。

**某来源“需人工确认”**
原因会显示在来源卡片上：robots.txt 禁止、HTTP 401/403、人机验证页面等。知更不会绕过这些限制。请确认该站点是否允许自动访问；不允许就删除或暂停该来源。

**某来源“解析失败”**
- 网页：选择器不再匹配（页面改版）。用浏览器开发者工具重新找到稳定的容器，更新 `html.selector` / `item_selector`。
- 条目数骤降：引擎拒绝了疑似改版后的结果并保留旧快照；确认页面后更新选择器即可。
- 订阅源/API：返回的不是 RSS/JSON（可能被重定向到 HTML 页面）。

**GitHub Releases 来源报 “API 速率限制”**
本地运行未设置 `GITHUB_TOKEN` 时每小时只有 60 次；Actions 中会自动使用令牌。

**修改了 `config/sources.json` 但没有生效**
配置在**下一次 Monitor 运行**时生效；想立即生效请手动 Run workflow。CI 会先用引擎校验配置，若报错请按提示修改。

**想重新建立某个来源的基线**
删除 `data/snapshots/<id>.json` 并提交，下次运行会重新“首次收录”。

**本地运行**
```bash
pip install -e "./engine[dev]"
python -m changeradar run -v
cd web && npm ci && npm run dev
```
