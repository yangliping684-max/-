# 信息源调研记录（v0.2）

所有结论都来自 **2026-10-11 在 GitHub Actions 运行器上的真实请求**（`Probe source` 工作流），而不是推测。
调研只做公开访问：遵守 robots.txt，不登录、不绕过验证码或访问限制，不使用未公开的内部接口。

复现方法：Actions → **Probe source** → Run workflow，输入网址（可选 CSS 选择器）。
或在本地运行 `python -m changeradar probe <url> --selector "<css>"`。

## 已接入（真实验证通过）

新来源在运行器上用**真实监控流水线**对线上数据的副本做了试运行（不提交任何数据），18/18 个来源检查成功。

| ID | 方式 | 验证结果 | 说明 |
| --- | --- | --- | --- |
| `bosch-china-jobs` | SmartRecruiters 官方公开 Posting API，分页 | ✅ 1,321–1,322 个中国区职位；职位页 `jobs.smartrecruiters.com/BoschGroup/{id}` 返回 200 且 robots 允许 | 逐页读取后用供应链/物流/采购/PMC/物料控制/生产计划/库存/仓储/需求计划/管培生同义词组在本地筛选；API 的 `q=` 是宽松全文检索（搜 "supply chain" 会返回销售岗位），不用于筛选 |
| `anthropic-jobs`（升级） | Greenhouse 公开 API | ✅ 实际有 **645** 个职位 | v0.1 被 500 条上限截断；v0.2 上限 2000，新增可见的 145 条作为基线，未产生误报 |
| `openai-news` | 官方 RSS `openai.com/news/rss.xml` | ✅ 1,287 条 | 网页版 `openai.com/news/` 对自动访问返回 **403**，因此只用 RSS |
| `anthropic-news` | 网页（CSS 选择器） | ✅ 14 条，含日期与链接 | 无 RSS；页面类名带构建哈希（`__KxYrHG__`），所以只用结构选择器 `a[href]:has(time)` |
| `cursor-changelog` | 网页（CSS 选择器） | ✅ | 服务端渲染，`main article` + `header h1` + `time` |
| `xai-release-notes` | 网页（CSS 选择器） | ✅ 50 条 | `docs.x.ai/developers/release-notes`，每条为 h3 + 锚点链接；页面只按月份分组，无逐条日期 → 发布日期显示“未提供” |
| `openai-codex-releases` | GitHub Releases API | ✅ | 发布说明极长（3 条约 1.4MB），只请求最近 5 条 |
| `claude-status` | 官方状态页 RSS `status.claude.com/history.rss` | ✅ 25 条 | 由 status.anthropic.com 页面中的 `<link rel="alternate">` 发现 |
| `openai-status` | 官方状态页 RSS `status.openai.com/feed.rss` | ✅ 111 条 | 同上，页面广告的订阅地址 |
| `claude-api-pricing` | 定价页（价格行比较） | ✅ 两次抓取价格签名一致 | `platform.claude.com/docs/en/about-claude/pricing`，13 个表格 |
| `claude-plans-pricing` | 定价页 | ✅ 两次抓取价格签名一致 | `claude.com/pricing`，只比较默认可见的价格 |
| `xai-api-pricing` | 定价页 | ✅ | `docs.x.ai/developers/pricing`，11 个表格 |
| `cursor-pricing` | 定价页 | ✅ | `cursor.com/pricing` |

v0.1 原有的 6 个来源全部保留，仅为 `claude-code-releases`、`openai-python-releases`、`anthropic-jobs` 增加了模块元数据。

## 暂不支持（附原因）

| 候选 | 结果 | 原因 / 后续 |
| --- | --- | --- |
| 宁德时代 `talent.catl.com` | 200，但正文仅 41 字符 | 跳转到 Moka 招聘系统的单页应用，职位由 JavaScript 加载；没有公开文档化的 API 或 RSS。不调用其内部接口 |
| 比亚迪 `job.byd.com` | 200，页面仅 905 字节 | 单页应用外壳，无服务端内容、无 RSS/API |
| 京东校招 `campus.jd.com` | 200，正文 4 字符 | JavaScript 渲染 |
| 京东招聘 `zhaopin.jd.com` | 200，有岗位名称 | 岗位链接全部是 `javascript:;`，**没有单个职位的原始网址**，不满足“必须提供原始链接”的要求 |
| 国家大学生就业服务平台 `www.ncss.cn` | 200 | 首页没有职位列表；职位检索需要登录或由脚本加载 |
| 国际组织实习平台 `gj.ncss.cn` | 200 | JavaScript 渲染 |
| 国聘 `www.iguopin.com` | 200，页面 1KB | 单页应用外壳 |
| OpenAI 网页 `openai.com/news/`、`openai.com/api/pricing/` | **403** | 访问受限，不尝试绕过。新闻改用官方 RSS；**OpenAI 定价目前无法监控** |
| xAI `x.ai/news` | **403** | 改用 docs.x.ai 的发布说明 |
| xAI 状态页 `status.x.ai` | **403** | 暂无替代 |

> 想监控这些企业的招聘：可关注它们是否提供公开职位订阅（RSS/邮件）或在 Greenhouse、Lever、SmartRecruiters 等提供官方公开接口的招聘系统发布职位；找到后用 Probe 工作流验证即可接入。

## 定价监控如何避免误报

定价页按“价格行”比较，而不是整页文字：

1. 表格的每一行合并为一行文本（`模型 | $5 / MTok | $25 / MTok`），单独的价格行带上其前面的标签（`Pro → $20`）。
2. 只比较这些价格行的集合；顺序变化、横幅、促销文案、排版变化都不会触发事件。
3. 只有价格行确实增减时才生成“定价变化”，并在卡片上展示变化前后的价格行。
4. 首次收录的定价页只是监控基线，明确标注“不代表价格变化”。
