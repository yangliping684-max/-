# 信息源调研记录

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


---

# v0.3 招聘来源调研（2026-10-11，GitHub Actions 运行器实测）

方法：

- 对每家候选企业访问其**官方招聘官网**，检查状态码、robots.txt、是否由 JavaScript 渲染，并识别页面引用的招聘系统指纹（`python -m changeradar research`）。
- 对提供**官方公开、文档化职位接口**的招聘系统（SmartRecruiters、Greenhouse、Lever）查询企业的公开看板。只有接口返回的**组织名称与企业一致**时才算验证通过。
- 通过后用真实监控流水线在数据副本上试运行，确认岗位数量、链接与字段，再写入配置。

## 已接入的招聘来源（11 家企业）

| 企业 | 渠道 | 验证结果（2026-10-11） | 收录范围 |
| --- | --- | --- | --- |
| 博世 Bosch | SmartRecruiters `BoschGroup` | 全球 4,932 个，中国 1,321 个；组织名 Bosch Group | 中国区全部职位 |
| Anthropic | Greenhouse `anthropic` | 645 个 | 全部职位 |
| 大陆集团 Continental | SmartRecruiters `Continental` | 全球 597 个，中国 24 个；组织名 Continental | 中国区 |
| 康捷空 Expeditors | SmartRecruiters `Expeditors` | 全球 476 个，中国 12 个 | 中国区 |
| 育碧 Ubisoft | SmartRecruiters `Ubisoft2` | 全球 339 个，中国 13 个（`Ubisoft` 标识无职位） | 中国区 |
| Canva | SmartRecruiters `Canva` | 全球 125 个，中国 6 个 | 中国区 |
| Flexport | Greenhouse `flexport` | 202 个，其中中国 26 个 | 全部（接口不支持按国家筛选） |
| 货拉拉 Lalamove | Lever `lalamove` | 180 个（香港、台湾、东南亚） | 全部 |
| 文远知行 WeRide | Lever `weride` | 16 个 | 全部 |
| Agoda | Greenhouse `agoda` | 318 个（亚太为主，含上海） | 全部 |
| 中国物流集团 | 官网首页“招聘公告”（HTML，`/zh-cn/articles/` 链接） | 1 条（华贸物流社会招聘公告，2026-08-26） | 仅首页公告；招聘系统为 JS 页面无法解析，永远标记“数据不完整”，不判定下架 |

试运行共 **2,738 个在招岗位/公告**：10 个 ATS 来源全部“数据完整”（获取数 = 接口报告的总数），中国物流集团为公告列表，标记“数据不完整”。

## 用户指定的候选企业：暂不支持

| 企业 | 官方渠道检查结果 | 原因 |
| --- | --- | --- |
| 宁德时代 | talent.catl.com → Moka 招聘系统 | JavaScript 单页应用，无公开文档化 API |
| 比亚迪 | job.byd.com（页面 905 字节） | 单页应用外壳 |
| 特斯拉 | tesla.com/careers 返回 **403** | 访问受限，不绕过 |
| 西门子 | jobs.siemens.com（服务端渲染搜索页） | 可访问且 robots 允许，但为全球职位、每页 6 条，没有已验证的国家筛选参数；没有公开 API。列入待支持，需要进一步确认分页与筛选的稳定性 |
| 施耐德电气 | careers.se.com（引用 iCIMS / Taleo） | 无免认证的公开职位 API |
| ABB | careers.abb（Phenom 平台） | 无公开 API |
| 联想 | jobs.lenovo.com（Avature 风格站点） | 首页无职位列表，未发现公开订阅或 API |
| 小米 / 美的 | hr.xiaomi.com / careers.midea.com | JavaScript 渲染 |
| 海尔 | haier.com 首页 | 未找到招聘入口链接 |
| 京东物流 | zhaopin.jd.com | 岗位链接均为 `javascript:;`，无单个职位网址 |
| 顺丰 / 菜鸟 / 德邦 / 中外运 / 极兔 | 官网 | JavaScript 渲染或首页无职位数据 |
| DHL | careers.dhl.com（Phenom 平台） | 无公开 API |
| 华为 / 腾讯 / 字节跳动 / 阿里巴巴 / 美团 | 招聘官网 | 全部为 JavaScript 单页应用 |
| 苹果 / 亚马逊 / 微软 | 招聘官网 | 职位搜索由脚本调用内部接口加载；内部接口未公开文档化，不使用 |

## 其他已验证但未接入的公开看板

SGS（SmartRecruiters，4,642 个，中国 0）、Stripe、Pinterest、Databricks、Samsara、Lucid Motors、Coinbase、OKX 等也有公开看板，但没有或几乎没有中国区职位。为避免用无关岗位“凑数量”，暂不接入。随时可以用“我的监控 → 新增信息源 → 企业公开招聘接口（ATS）”添加。

## 如何继续扩充

1. 在“我的监控”中选择“企业公开招聘接口（ATS）”，填写招聘系统和企业的公开标识（招聘页网址中的名称）。
2. 先在 Actions → Probe source 中验证，或把企业加入 `docs/research/ats_candidates.json` 后推送到 `probe/**` 分支，运行 `changeradar research`。
3. 只有组织名称匹配、能返回职位时才写入配置。
