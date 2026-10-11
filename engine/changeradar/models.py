"""Pydantic models shared by the engine.

Three kinds of data live here and must not be confused:

* Config (``config/*.json``): public, user-edited, committed to the repo.
* State / output (``data/*.json``): public, machine-written by the engine.
* Secrets: never modelled here. They only come from environment variables
  (GitHub Actions Secrets) at runtime and are never written to disk.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SOURCE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")


class SourceType(StrEnum):
    RSS = "rss"  # RSS 2.0 / Atom / RDF feeds
    API = "api"  # Official public JSON APIs, mapped via ApiOptions
    GITHUB_RELEASES = "github_releases"  # GitHub REST API releases endpoint
    HTML = "html"  # Public web page, located via CSS selectors


class Credibility(StrEnum):
    OFFICIAL = "official"  # The organisation's own channel
    RELIABLE = "reliable"  # Well-known, generally accurate secondary source
    UNVERIFIED = "unverified"
    LOW = "low"


class SourceStatus(StrEnum):
    PENDING = "pending"  # 尚未检查
    OK = "ok"  # 正常（已建立基线）
    UNCHANGED = "unchanged"  # 内容无变化
    CHANGED = "changed"  # 发现变化
    FETCH_ERROR = "fetch_error"  # 请求失败
    PARSE_ERROR = "parse_error"  # 解析失败
    PAUSED = "paused"  # 暂停监控
    BLOCKED = "blocked"  # robots.txt 禁止 / 需要登录等，需人工确认


class ChangeType(StrEnum):
    INITIAL = "initial"  # 首次收录（建立基线时的已有条目）
    ADDED = "added"
    MODIFIED = "modified"
    REMOVED = "removed"


class Level(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# --------------------------------------------------------------------------- config


class HtmlOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Stable region that contains the meaningful content. Required for html sources:
    # monitoring a whole page is too noisy to be useful.
    selector: str
    # When set, each match inside ``selector`` becomes an individual item (list mode).
    # When unset, the whole region is one item (page mode, diffed line by line).
    item_selector: str | None = None
    title_selector: str | None = None
    link_selector: str | None = None  # defaults to the first <a href> in the item
    date_selector: str | None = None
    summary_selector: str | None = None
    # Elements removed before extracting text (ads, counters, "last updated" widgets…).
    ignore_selectors: list[str] = Field(default_factory=list)


class ApiPagination(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Offset pagination: the engine sets ?<offset_param>=0, page_size, 2*page_size…
    offset_param: str = "offset"
    page_size: int = Field(default=100, ge=1, le=500)
    max_pages: int = Field(default=20, ge=1, le=50)  # hard bound on requests per run


class ApiOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Dotted path to the item list in the JSON payload ("" = payload itself is the list).
    items_path: str = ""
    id_field: str = "id"
    title_field: str = "title"
    url_field: str = "url"
    summary_field: str | None = None
    published_field: str | None = None  # only map a field that really is a publication date
    updated_field: str | None = None
    # Extra fields shown on cards, e.g. {"location": "location.name"}.
    extra_fields: dict[str, str] = Field(default_factory=dict)
    # Public page of an item when the payload only has an API link, e.g.
    # "https://jobs.smartrecruiters.com/BoschGroup/{id}". Placeholders are item fields.
    url_template: str | None = None
    # Dotted path to the total count, so a truncated page is reported honestly.
    total_path: str | None = None
    pagination: ApiPagination | None = None


class AtsOptions(BaseModel):
    """Shortcut for official public job-board APIs (see ats.py)."""

    model_config = ConfigDict(extra="forbid")

    provider: Literal["smartrecruiters", "greenhouse", "lever"]
    id: str  # the company's public board identifier
    country: str | None = None  # SmartRecruiters only: ISO country filter, e.g. "cn"


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    type: SourceType = SourceType.API
    url: str = ""
    category: str
    enabled: bool = True
    keywords: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    # If true, items that match none of ``keywords`` are filtered out (not just scored lower).
    require_keywords: bool = False
    priority: int = Field(default=3, ge=1, le=5)
    credibility: Credibility = Credibility.UNVERIFIED
    frequency: Literal["daily"] = "daily"  # v1 only supports daily; schema leaves room to grow
    max_items: int = Field(default=50, ge=1, le=2000)
    # How many pre-existing items to keep as "首次收录" when the baseline is created.
    baseline_items: int = Field(default=10, ge=0, le=100)
    # Whether disappearing items count as "removed" events. Feeds/APIs usually only show
    # the latest N entries, so removals there are noise; for job/notice pages they matter.
    track_removals: bool | None = None
    # Extra regexes stripped before hashing (dynamic counters, timestamps…).
    ignore_patterns: list[str] = Field(default_factory=list)
    html: HtmlOptions | None = None
    api: ApiOptions | None = None
    notes: str = ""
    # v0.2 — optional domain profile that enables structured facets:
    #   jobs: company / city / job type / education / graduation year (only when stated)
    #   ai: update type (new model, feature, version, API change…)
    #   pricing: page-mode pricing page; events only when price lines actually change
    #   status: official status page feed (service announcements)
    profile: Literal["general", "jobs", "ai", "pricing", "status"] = "general"
    company: str = ""  # organisation behind the source (employer / AI vendor)
    careers_url: str = ""  # official careers page shown as "招聘官网" (v0.3)
    channel: str = ""  # human description of the data channel, e.g. "SmartRecruiters 官方公开 API"
    ats: AtsOptions | None = None  # v0.3: fills type/url/api from a verified preset
    industry: str = ""  # for job filters, e.g. "汽车零部件 / 制造业"

    @field_validator("id")
    @classmethod
    def _check_id(cls, v: str) -> str:
        if not SOURCE_ID_RE.match(v):
            raise ValueError("id 只能包含小写字母、数字和连字符，长度 2-64")
        return v

    @field_validator("url")
    @classmethod
    def _check_url(cls, v: str) -> str:
        if not v.startswith(("https://", "http://")):
            raise ValueError("url 必须以 http:// 或 https:// 开头")
        return v

    @field_validator("ignore_patterns")
    @classmethod
    def _check_patterns(cls, v: list[str]) -> list[str]:
        for p in v:
            re.compile(p)
        return v

    @model_validator(mode="before")
    @classmethod
    def _expand_ats(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("ats"):
            from .ats import preset

            a = data["ats"]
            p = preset(a["provider"], a["id"], a.get("country"))
            data = {**data, "type": "api", "url": data.get("url") or p["url"], "api": data.get("api") or p["api"],
                    "channel": data.get("channel") or p["channel"]}
            data.setdefault("profile", "jobs")
        return data

    @model_validator(mode="after")
    def _check_type_options(self) -> Source:
        if self.type == SourceType.HTML and self.html is None:
            raise ValueError("html 类型的信息源必须提供 html.selector")
        if self.type == SourceType.API and self.api is None:
            raise ValueError("api 类型的信息源必须提供 api 字段映射")
        return self

    @property
    def removals_tracked(self) -> bool:
        if self.track_removals is not None:
            return self.track_removals
        return self.type == SourceType.HTML


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str = ""
    color: str = "#64748b"


class SourcesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    categories: list[Category]
    sources: list[Source]

    @model_validator(mode="after")
    def _check_refs(self) -> SourcesConfig:
        ids = [s.id for s in self.sources]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"信息源 id 重复: {sorted(dupes)}")
        cats = {c.id for c in self.categories}
        for s in self.sources:
            if s.category not in cats:
                raise ValueError(f"信息源 {s.id} 引用了不存在的分类 {s.category}")
        return self


class LevelThresholds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    high: int = Field(default=70, ge=0, le=100)
    medium: int = Field(default=45, ge=0, le=100)

    @model_validator(mode="after")
    def _order(self) -> LevelThresholds:
        if self.medium > self.high:
            raise ValueError("medium 阈值不能高于 high")
        return self


class DigestRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    max_items: int = Field(default=30, ge=1, le=200)
    min_level: Level = Level.LOW


class GithubIssueRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    min_level: Level = Level.HIGH
    labels: list[str] = Field(default_factory=lambda: ["changeradar"])
    max_issues_per_day: int = Field(default=1, ge=1, le=5)


class RulesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = 1
    timezone: str = "Asia/Shanghai"  # used for "today" and digest dates
    levels: LevelThresholds = Field(default_factory=LevelThresholds)
    # Alert keywords apply to every source; a hit raises the score and creates an alert.
    alert_keywords: list[str] = Field(default_factory=list)
    # Events scoring at least this much go into the notification center as alerts.
    importance_threshold: int = Field(default=70, ge=0, le=100)
    digest: DigestRule = Field(default_factory=DigestRule)
    github_issue: GithubIssueRule = Field(default_factory=GithubIssueRule)
    # Hard cap of alerts per run, so a misconfigured source can never spam.
    max_alerts_per_run: int = Field(default=20, ge=1, le=200)
    # v0.2 — synonym groups usable in any keyword list: {"供应链": ["supply chain", "SCM"]}.
    # Referencing the group name matches the name or any synonym.
    keyword_groups: dict[str, list[str]] = Field(default_factory=dict)
    # Job-function groups used to label job postings (subset of names in keyword_groups
    # or standalone groups). Purely descriptive; never filters anything by itself.
    job_functions: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- parsing


class Item(BaseModel):
    """One meaningful unit extracted from a source (feed entry, job posting, page region)."""

    key: str  # stable identity within the source
    title: str
    url: str
    summary: str = ""
    published_at: datetime | None = None  # only when the source states it reliably
    updated_at: datetime | None = None
    extra: dict[str, str] = Field(default_factory=dict)
    # Full normalised text for page-mode items (diffed line by line).
    text: str = ""


class SnapshotItem(BaseModel):
    title: str
    url: str
    hash: str
    summary: str = ""
    published_at: datetime | None = None
    text: str = ""


class Snapshot(BaseModel):
    source_id: str
    taken_at: datetime
    etag: str | None = None
    last_modified: str | None = None
    items: dict[str, SnapshotItem] = Field(default_factory=dict)
    # Keys seen at any time (bounded), so an entry that drops out of a feed window and
    # reappears later is not reported as new again.
    seen_keys: list[str] = Field(default_factory=list)
    # v0.2 — what was monitored (url, max_items, pagination). When the scope grows,
    # newly visible items join the baseline instead of being reported as new.
    scope: str | None = None


# --------------------------------------------------------------------------- output


class ScoreFactor(BaseModel):
    factor: str
    points: int
    reason: str


class Event(BaseModel):
    id: str
    source_id: str
    source_name: str
    category: str
    change_type: ChangeType
    title: str
    url: str
    summary: str = ""
    detected_at: datetime
    published_at: datetime | None = None
    source_updated_at: datetime | None = None
    matched_keywords: list[str] = Field(default_factory=list)
    alert_keywords: list[str] = Field(default_factory=list)
    deadline: str | None = None  # ISO date, only when explicitly stated by the source
    score: int = 0
    level: Level = Level.LOW
    score_factors: list[ScoreFactor] = Field(default_factory=list)
    diff: dict[str, list[str]] | None = None  # {"added": [...], "removed": [...]}
    extra: dict[str, str] = Field(default_factory=dict)
    # v0.2 — structured facets (job fields, AI update type…). Absent in v0.1 events.
    facets: dict[str, str] = Field(default_factory=dict)


class SourceState(BaseModel):
    id: str
    status: SourceStatus = SourceStatus.PENDING
    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    last_change_at: datetime | None = None
    message: str = ""
    consecutive_failures: int = 0
    item_count: int = 0
    http_status: int | None = None


class RunRecord(BaseModel):
    id: str
    started_at: datetime
    finished_at: datetime
    trigger: str = "manual"
    sources_total: int = 0
    sources_ok: int = 0
    sources_failed: int = 0
    sources_paused: int = 0
    new_events: int = 0
    filtered: int = 0
    duplicates: int = 0
    errors: list[dict[str, str]] = Field(default_factory=list)


class Notification(BaseModel):
    id: str
    kind: Literal["alert", "digest", "system"]
    created_at: datetime
    title: str
    body: str = ""
    event_ids: list[str] = Field(default_factory=list)
    level: Level = Level.LOW


def model_dump_json_ready(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(mode="json", exclude_none=False)
