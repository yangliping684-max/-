# 来源调研工具

- `candidates.json`：v0.2 调研过的候选地址。推送到 `probe/**` 分支时，Probe 工作流会在 GitHub 运行器上逐一检查。
- `verify`：存在时，Probe 工作流还会用真实监控流水线对 `data/` 的**副本**做一次试运行（可写入逗号分隔的来源 ID 只检查部分来源）。不会提交任何数据。
- 结论汇总见 [../SOURCES.md](../SOURCES.md)。
