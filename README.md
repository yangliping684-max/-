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
- 更多文档：[信息源调研](docs/SOURCES.md) · [部署与排错](docs/DEPLOYMENT.md) · [路线图](docs/ROADMAP.md)

---

## 当前状态（请先读）

**v0.3** 把招聘雷达升级为“当前在招岗位库”：自动检查 **11 家企业**的官方公开招聘渠道，展示全部在招岗位（试运行约 2,700 个），并与变化事件（新增 / 下架提醒）分离。AI 动态、宏观、学术等模块保持不变。

| 项目 | 状态 |
| --- | --- |
| 引擎 | ✅ 110 个离线测试（含线上 v0.1/v0.2 数据兼容测试） |
| 前端 | ✅ 类型检查、50 个单元测试、生产构建 |
| 招聘来源 | ✅ 11 家企业，全部在 GitHub Actions 运行器上用真实流水线试运行通过（详见 [docs/SOURCES.md](docs/SOURCES.md)） |
| 无法接入的企业 | 宁德时代、比亚迪、华为、腾讯等 20 余家：JS 渲染、403、无公开 API 等，逐一记录原因 |

## v0.3 新功能

- **当前在招岗位库**（`data/jobs/<来源>.json` + `index.json`）：每次成功检查后用全部分页结果重建，按稳定职位 ID 去重，保留首次收录时间。
  - 只有在确认抓取完整（获取数 = 接口报告总数）时才判定下架；不完整时保留旧岗位并标注“未确认在招”和“数据不完整”。
  - 抓取失败不改动岗位库。首次建库的岗位标记为“建库时已在招”，不会产生大量“新增”提醒。
- **可复用的招聘系统适配器**：配置里写 `"ats": {"provider": "smartrecruiters|greenhouse|lever", "id": "...", "country": "cn"}` 即可接入一家企业（只支持官方公开、文档化的职位接口）。
- **招聘雷达页面**：企业卡片（行业、在招数、完整性、最近检查、来源、招聘官网直达），全部岗位分页加载，城市分布、岗位类型统计、最近新增，收藏（本地保存，岗位下架后仍保留）与已查看/未查看。
  - 筛选：企业、省份 / 城市、职能（物流与供应链 / 采购与物料管理 / PMC·MC / 生产计划 / 仓储与运营 / 数据分析）、招聘类型、学历、毕业年份、发布时间、最新收录时间。
  - 所有条件均可选；未注明的字段显示“未提供”，不推测。
- **规模化运行**：单次运行 20 分钟时间预算，超出后按“最久未检查优先”顺延到下次，已有数据不受影响；每个来源独立失败；岗位库文件紧凑存储，按企业懒加载。
- **调研工具**：`python -m changeradar research` 检查企业官网的招聘系统指纹与官方公开看板（组织名必须匹配）。

## v0.2 新功能

- **招聘雷达**（`/jobs`）：企业、岗位、地点、招聘性质（实习 / 暑期实习 / 日常实习 / 校园招聘 / 应届生 / 管培生 / 社招）、学历、毕业届别、发布时间、截止日期、申请入口。只展示来源明确提供的信息，其余显示“未提供”。
  - 可选筛选：毕业年份、学历、城市、行业、公司、岗位职能、招聘类型、发布时间、关键词；不写死任何届别，条件只保存在浏览器。
  - “包含未注明该条件的岗位”开关：很多职位不写届别或学历，关闭后只看明确符合的岗位。
- **AI 动态**（`/ai`）：新模型 / 新功能 / 版本更新 / API 变更 / 定价变化 / 服务公告 / 一般新闻，按厂商筛选；分类规则可解释（悬停徽章可看依据）。
- **定价页监控**：只在价格行真正变化时生成“定价变化”，展示变化前后的价格；横幅、排版、动态内容不会被误报为涨价或降价。
- **同义词组与组合关键词**（`rules.json → keyword_groups`）：`供应链` 同时匹配 “supply chain / SCM”；`实习 & 采购` 表示同时命中。可在“情报规则”页编辑。
- **引擎增强**：API 分页（`pagination`）、职位页地址模板（`url_template`）、按字段值取值（`customField[fieldLabel=Position type].valueLabel`）、截断如实提示（`total_path`）、监控范围扩大时自动并入基线（不误报为新增）、v0.1 数据自动补充结构化字段（不改变事件 ID）。
- **来源调研工具**：`python -m changeradar probe <url>` 与 Actions 中的 **Probe source** 工作流，在真实运行器上检查 robots、状态码、内容类型、订阅地址和选择器。
- **修复**：订阅源在周末合法地为空（arXiv）时不再报“解析失败”；卡片本身就是链接时能正确提取原文网址；GitHub 发布说明过大时按需请求。

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

**预置来源**（18 个，完整调研记录见 [docs/SOURCES.md](docs/SOURCES.md)）：

| 模块 | 来源 |
| --- | --- |
| 实习与招聘 | 博世中国（SmartRecruiters 官方 API，按供应链类职能筛选）、Anthropic（Greenhouse） |
| AI 与科技 | OpenAI News RSS、Anthropic Newsroom、Cursor Changelog、xAI API Release Notes、Claude Code / OpenAI Python SDK / OpenAI Codex Releases、Claude 与 OpenAI 服务状态、Claude API / Claude 套餐 / xAI API / Cursor 定价页、python.org 版本页 |
| 宏观与财经 | 美联储新闻稿 RSS |
| 学术与教育 | arXiv cs.AI（关键词过滤） |

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
python -m pytest engine     # 110 个测试：解析、噪声、diff、去重、评分、抓取、分页、定价、职位字段、旧数据兼容
cd web && npm test          # 50 个测试：配置校验、草稿/同步状态、导入导出、筛选排序、招聘筛选、时区统计
```

全部测试离线运行（HTTP 通过 `httpx.MockTransport` 模拟），样例文件见 `engine/tests/fixtures/`。

## 已完成 / 未完成功能

**已完成（v0.3）**：11 家企业的当前在招岗位库、ATS 适配器、完整性判定、企业/城市/职能等多维筛选、收藏与已查看。

**已完成（v0.2）**：招聘雷达（结构化岗位字段 + 可选个人筛选条件）、AI 动态（类型识别 + 厂商筛选）、定价页价格变化检测、同义词组与组合关键词、API 分页、来源调研工具。

**已完成（v0.1）**：五大核心功能的规则版实现——情报驾驶舱、信息源管理（含导入导出与真实同步状态）、变化检测引擎、情报中心（排序/搜索/筛选/已读/收藏/归档/历史）、站内通知 + 每日摘要 + 可选 GitHub Issues；深色模式；桌面/iPad/手机适配；CI、定时监控与 Pages 自动部署。

**未完成 / 明确不在当前版本**：

- 宁德时代、比亚迪、京东、国家大学生就业服务平台等招聘渠道：页面由 JavaScript 渲染或缺少单个职位链接，且没有公开 API（见 [docs/SOURCES.md](docs/SOURCES.md)）。
- OpenAI 定价、x.ai 新闻与状态页：对自动访问返回 403，不尝试绕过。
- 招聘岗位的学历、届别、截止日期：列表接口通常不提供，只在标题或字段明确写出时显示，否则为“未提供”（不抓取每个职位的详情页，以控制请求量）。
- 高于每天一次的检查频率（schema 已预留 `frequency` 字段）。
- 网页中直接触发监控（需要令牌，出于安全不在前端实现；请使用 Actions 的 Run workflow）。
- 浏览器内直接写入仓库配置（同上，需手动提交导出的文件）。
- 邮件、Telegram、企业微信、微信通知（路线图；微信仅在确认官方允许后开发）。
- JavaScript 渲染的页面（引擎不执行 JS；此类页面会解析失败并提示人工确认）。
- 私密配置/私密同步。
- AI 分析（“为什么重要 / 接下来做什么”）：见 [docs/ROADMAP.md](docs/ROADMAP.md)。涉及付费 API，开发前会先与你确认。

## License

MIT
