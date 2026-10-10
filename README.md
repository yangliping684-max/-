# 知更 ChangeRadar

> **Stay Informed. Stay Ahead.** · 重要的变化，值得被看见。

知更是一个可以免费部署在 GitHub 上的**个人互联网情报雷达**：你设定关注的公开信息源，GitHub Actions 每天自动检查，发现变化后过滤、去重、评分，生成情报卡片，并按你的规则提醒。

它不是 RSS 阅读器：它比较的是**快照之间的变化**（新增 / 修改 / 移除），并对每条变化给出可解释的重要性评分。

```
设定信息源 → 定期监测 → 发现变化 → 过滤无关内容 → 去重与分类 → 情报卡片 → 按规则提醒
```

---

## 目录

- [当前状态（请先读）](#当前状态请先读)
- [架构](#架构)
- [快速开始：部署到 GitHub](#快速开始部署到-github)
- [本地开发](#本地开发)
- [配置信息源](#配置信息源)
- [变化检测如何工作](#变化检测如何工作)
- [重要性评分](#重要性评分)
- [通知与防打扰](#通知与防打扰)
- [数据与隐私](#数据与隐私)
- [测试](#测试)
- [已完成 / 未完成功能](#已完成--未完成功能)
- 更多文档：[部署与排错](docs/DEPLOYMENT.md) · [第二阶段 AI 路线图](docs/ROADMAP.md)

---

## 当前状态（请先读）

| 项目 | 状态 |
| --- | --- |
| Python 监控引擎（RSS/Atom、公开 API、GitHub Releases、网页） | ✅ 已实现，69 个离线单元/集成测试通过 |
| 前端（总览 / 情报中心 / 我的监控 / 规则 / 历史 / 通知 / 设置） | ✅ 已实现，类型检查、26 个单元测试与生产构建通过 |
| GitHub Actions：CI、每日监控、Pages 部署 | ✅ 已编写；**需要在你的仓库中首次运行后才算线上验证** |
| 预置的 6 个真实信息源 | ⚠️ **尚未线上验证**。开发环境的网络策略屏蔽了这些站点，无法在开发时访问；首次 Actions 运行后，每个来源的真实状态会如实显示在“我的监控”中 |

`data/` 目录在仓库中初始为空。网站在首次监控前只显示“尚未运行”的引导，**不会展示任何模拟数据**。
开发时用于截图和测试的数据全部来自 `engine/tests/fixtures/` 中**明确标注为测试样例**的本地 HTML / RSS / JSON 文件。

## 架构

GitHub Pages 只能托管静态文件，不能运行后台服务，因此职责划分如下：

```
┌──────────────────────────── GitHub 仓库 ────────────────────────────┐
│ config/sources.json, rules.json   ← 公共配置：唯一决定云端监控什么    │
│            │                                                         │
│            ▼   每天 23:17 UTC（北京时间 07:17）或手动触发             │
│ GitHub Actions: monitor.yml                                          │
│   python -m changeradar run                                          │
│     fetch(robots.txt, ETag/Last-Modified, 重试, 限速)                 │
│     → parse(RSS/Atom | JSON API | GitHub API | HTML+CSS 选择器)       │
│     → normalize(去标签/导航/广告/计数器/时间戳)                        │
│     → diff(与上次快照比较：新增/修改/移除)                             │
│     → filter(关键词/排除词) → dedup → score → notify                   │
│     → 原子写入 data/*.json                                            │
│            │ 只在有意义的变化时 commit；随后调用 pages.yml 部署         │
│            ▼                                                         │
│ data/  status / events / runs / notifications / snapshots / archive   │
└────────────┼─────────────────────────────────────────────────────────┘
             ▼
  GitHub Pages: React 单页应用，读取 data/*.json 与 config/*.json
  浏览器 localStorage: 已读/收藏/归档、主题、未同步的配置草稿
```

| 目录 | 说明 |
| --- | --- |
| `engine/changeradar/` | Python 3.12+ 监控引擎（httpx、BeautifulSoup、feedparser、Pydantic） |
| `engine/tests/` | pytest 测试与离线样例（`fixtures/`） |
| `web/` | React 19 + TypeScript + Vite + Tailwind CSS 4 + Radix(shadcn 风格组件) + Recharts + Framer Motion |
| `config/` | 公共监控配置 |
| `data/` | 引擎输出的公共数据 |
| `.github/workflows/` | `ci.yml`、`monitor.yml`、`pages.yml` |

## 快速开始：部署到 GitHub

1. **Fork 或推送**本仓库到你的 GitHub 账号（仓库需为 Public 才能免费使用 Pages）。
2. **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**（监控需要提交 `data/`）。
4. 打开 **Actions** 页面，如果提示工作流被禁用（Fork 默认禁用），点击启用。
5. 在 Actions 中选择 **Monitor → Run workflow**。首次运行会为每个来源建立基线（“首次收录”），约 1–3 分钟后自动部署网站。
6. 访问 `https://<你的用户名>.github.io/<仓库名>/`。

之后每天自动运行。无需配置任何密钥：`GITHUB_TOKEN` 由 Actions 自动提供。
常见问题见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 本地开发

```bash
# 引擎
python -m venv .venv && source .venv/bin/activate
pip install -e "./engine[dev]"
python -m changeradar validate          # 校验 config/
python -m pytest engine                 # 离线测试，不需要联网
python -m changeradar run               # 真实抓取，写入 data/（需要联网）
python -m changeradar run --only fed-press-releases

# 前端（Node 22）
cd web
npm ci
npm run dev        # 自动把 ../data 和 ../config 复制到 public/ 后启动
npm test
npm run build
```

## 配置信息源

云端监控**只读取** `config/sources.json`。网页中“我的监控”里的新增/修改/删除会保存为**本地草稿**并明确标记“未同步”；点击“如何同步”→ 导出完整的 `sources.json` → 在 GitHub 上替换并提交。网站重新部署后，草稿会自动识别为“已同步”并消失。浏览器从不持有 GitHub 令牌，因此不能、也不假装能直接写仓库。

```jsonc
{
  "id": "anthropic-jobs",            // 小写字母/数字/连字符；用于关联快照，创建后不要修改
  "name": "Anthropic 公开职位",
  "type": "api",                     // rss | api | github_releases | html
  "url": "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs",
  "category": "jobs",                // 引用 categories 中的 id（分类可自由增删）
  "keywords": ["intern"],            // 命中加分
  "exclude_keywords": ["senior"],    // 命中则过滤
  "require_keywords": false,         // true = 只保留命中 keywords 的条目
  "priority": 4,                     // 1-5
  "credibility": "official",         // official | reliable | unverified | low
  "frequency": "daily",              // 第一版仅支持每天
  "max_items": 500,
  "baseline_items": 10,              // 首次建立基线时保留多少条作为“首次收录”
  "track_removals": null,            // 默认：网页追踪移除，订阅源/API 不追踪
  "ignore_patterns": ["\\d+ stars"], // 额外的噪声正则
  "api": { "items_path": "jobs", "id_field": "id", "title_field": "title", "url_field": "absolute_url",
           "published_field": "first_published", "extra_fields": { "location": "location.name" } }
}
```

网页类型示例：

```json
"html": {
  "selector": ".notice-list",          // 必填：稳定的内容区域
  "item_selector": "li",               // 可选：逐条追踪；不填则整块区域逐行比较
  "title_selector": "a", "date_selector": ".date",
  "ignore_selectors": [".views", ".ad"]
}
```

**预置来源**（覆盖五大类中的四类 + 一个普通网页示例）：

| ID | 类型 | 类别 | 说明 |
| --- | --- | --- | --- |
| `claude-code-releases` | GitHub Releases | AI 与科技 | anthropics/claude-code 发布 |
| `openai-python-releases` | GitHub Releases | AI 与科技 | openai/openai-python 发布 |
| `fed-press-releases` | RSS | 宏观与财经 | 美联储官方新闻稿 |
| `arxiv-cs-ai` | RSS | 学术与教育 | arXiv cs.AI，只保留命中关键词的论文 |
| `python-releases` | 网页 | AI 与科技 | python.org 下载页版本列表（CSS 选择器示例） |
| `anthropic-jobs` | 公开 API | 实习与招聘 | Greenhouse 公开职位接口 |

中文高校/机构通知页面没有预置：它们的页面结构差异大，部分站点有反爬或登录机制，必须由你针对具体页面配置选择器并确认允许访问。

## 变化检测如何工作

1. **请求**：遵守 robots.txt（RFC 9309：4xx 视为无限制，5xx/不可达视为暂停访问）；官方 API（GitHub、Greenhouse）受其 API 条款约束而非 robots.txt。发送 `If-None-Match` / `If-Modified-Since`，304 直接判定无变化。超时 20 秒，最多 3 次指数退避重试，遵守 `Retry-After`，同一主机请求间隔 ≥ 2 秒，响应上限 5MB。
2. **不绕过访问限制**：401/403/451、登录墙、人机验证页面会被标记为“需人工确认”，不会重试或绕过。
3. **解析与清洗**：去除 script/style/nav/广告等；网页只在指定的 CSS 区域内提取文本。
4. **噪声过滤**：哈希前剥离时钟时间、“阅读量 123”、“更新于…”、版权年份、“3 小时前”等动态内容，并忽略大小写与空白差异——**纯排版变化不会产生事件**（有测试覆盖）。
5. **比较**：按条目 key（链接/GUID/ID）与上次快照比较，得到新增、修改（附逐行 diff，并识别“小幅修改”）、移除。
6. **去重**：事件 ID = hash(来源, 条目, 变化类型, 内容)，跨运行与归档去重；同一 URL 在不同来源出现只记录一次；曾经见过的条目重新出现在订阅窗口中不会再次算作新增。
7. **安全保护**：
   - 抓取或解析失败**不会覆盖快照、不会删除历史**；只更新该来源状态并记录错误。
   - 列表条目数骤降 80% 以上视为“疑似页面结构变化”，判为解析失败，而不是产生大量“移除”事件。
   - 所有数据文件原子写入（临时文件 + fsync + rename）；读取到损坏的文件时拒绝运行，而不是从空白重新开始。
8. **日期诚实**：只有来源明确给出的发布日期才显示为“发布日期”；Atom 的 `<updated>` 单独显示为“来源更新”；无法识别时显示“发布日期未知”，绝不用检测时间冒充。

来源状态：`尚未检查`、`正常`（已建立基线）、`内容无变化`、`发现变化`、`请求失败`、`解析失败`、`暂停监控`、`需人工确认`。

## 重要性评分

基于规则、完全可解释：每条情报的详情里列出每一项得分及原因。评分**只用于辅助筛选和排序，不代表客观事实**。

| 因素 | 分值 |
| --- | --- |
| 基础分 | +20 |
| 信息源优先级 1/2/3/4/5 | −10 / −5 / 0 / +8 / +15 |
| 可信度 官方/可靠/未验证/低 | +10 / +5 / 0 / −10 |
| 新增 / 修改 / 移除 / 首次收录 | +15 / +8 / 0 / −15 |
| 小幅修改 | −15 |
| 关注关键词（每个 +8，上限） | +16 |
| 提醒关键词 | +20 |
| 发布于 24h / 3 天 / 7 天内；超过 30 天；未知 | +15 / +10 / +5；−10；0 |
| 截止日期 ≤14 天 / 更晚 / 已过 | +15 / +8 / −10 |

总分截断到 0–100；等级阈值（默认 重要 ≥70、关注 ≥45）在 `config/rules.json` 中配置。截止日期只在出现“截止 / deadline / apply by”等提示词且日期带年份时识别。

## 通知与防打扰

- **站内通知中心**：达到 `importance_threshold` 或命中 `alert_keywords` 的新变化（首次收录不提醒）。
- **每日摘要**：每个本地日期一条，同日多次运行时原地更新；同时写入 `data/digests/YYYY-MM-DD.md`。
- **GitHub Issues（可选，默认关闭）**：在 `rules.json` 设置 `github_issue.enabled: true`，达到等级的日报会发为 Issue，GitHub 会按你的通知设置发邮件。使用 Actions 自带 `GITHUB_TOKEN`。
- **防重复**：已提醒事件 ID 持久化，同一事件只提醒一次；单次运行的提醒合并为一条；`max_alerts_per_run` 上限；每天最多 `max_issues_per_day` 个 Issue；来源异常只在“正常 → 失败”的转变时通知一次。

## 数据与隐私

| 类别 | 位置 | 可见性 |
| --- | --- | --- |
| 公共监控配置 | `config/*.json` | 公开（你提交） |
| 公共情报数据 | `data/*.json` | 公开（Actions 写入） |
| 浏览器本地偏好 | localStorage | 仅本浏览器；可在设置中备份/恢复 |
| 私密信息与凭据 | GitHub Actions Secrets | 永不进入前端或仓库（有测试检查令牌不会写入 data/） |

仓库是公开的：**不要在配置中写入个人隐私**。需要私密监控时，应使用私有仓库（私有仓库的 Pages 需要付费计划）或其他后端存储——第一版**不提供**私密同步能力。

**提交策略**：有真实变化（新情报、来源状态变化、快照内容变化、配置增删）时立即提交；平静的日子每 20 小时最多一次“心跳”提交以保存检查时间；同日无变化的重复手动运行不提交。无论是否提交，部署都使用本次运行的最新数据，网站上的“最近检查时间”始终准确。

## 测试

```bash
python -m pytest engine     # 69 个测试：解析、噪声、diff、去重、评分、抓取重试/超时/robots、端到端流水线、原子写入
cd web && npm test          # 26 个测试：配置校验、草稿/同步状态、导入导出、筛选排序、时区统计
```

全部测试离线运行（HTTP 通过 `httpx.MockTransport` 模拟），样例文件见 `engine/tests/fixtures/`。

## 已完成 / 未完成功能

**已完成（第一版）**：五大核心功能的规则版实现——情报驾驶舱、信息源管理（含导入导出与真实同步状态）、变化检测引擎、情报中心（排序/搜索/筛选/已读/收藏/归档/历史）、站内通知 + 每日摘要 + 可选 GitHub Issues；深色模式；桌面/iPad/手机适配；CI、定时监控与 Pages 自动部署。

**未完成 / 明确不在第一版**：

- 预置来源的线上验证（需你的仓库首次运行，见上文）。
- 高于每天一次的检查频率（schema 已预留 `frequency` 字段）。
- 网页中直接触发监控（需要令牌，出于安全不在前端实现；请使用 Actions 的 Run workflow）。
- 浏览器内直接写入仓库配置（同上，需手动提交导出的文件）。
- 邮件、Telegram、企业微信、微信通知（路线图；微信仅在确认官方允许后开发）。
- JavaScript 渲染的页面（引擎不执行 JS；此类页面会解析失败并提示人工确认）。
- 私密配置/私密同步。
- AI 分析（“为什么重要 / 接下来做什么”）：见 [docs/ROADMAP.md](docs/ROADMAP.md)。涉及付费 API，开发前会先与你确认。

## License

MIT
