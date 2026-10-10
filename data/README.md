# data/ — 公共情报数据（由监控引擎自动写入）

此目录由 GitHub Actions 中的 `python -m changeradar run` 维护，**请勿手动编辑**。
所有文件公开可见；其中不包含任何密钥或个人偏好。

| 文件 | 内容 |
| --- | --- |
| `status.json` | 每个信息源的检查状态、最近检查/成功/变化时间、最近一次运行摘要 |
| `events.json` | 最近 1000 条情报（更早的移入 `archive/YYYY-MM.json`） |
| `runs.json` | 最近 90 次被持久化的运行记录 |
| `notifications.json` | 站内通知：提醒、每日摘要、异常 |
| `digests/YYYY-MM-DD.md` | 每日摘要 Markdown |
| `snapshots/<id>.json` | 每个来源上次成功检查的内容快照（用于比较变化） |
| `state/notified.json` | 已提醒过的事件 ID，防止重复提醒 |

仓库初始状态下这里没有数据：首次运行 Monitor 工作流后才会生成。网站不会展示任何模拟数据。
