"""The monitoring run: config → fetch → parse → diff → filter/dedup → score → persist → notify."""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import notify
from .classify import ai_facets, job_facets, price_changed
from .config import load_rules, load_sources
from .diff import Change, detect_changes, suspicious_shrink
from .fetcher import FetchError, Fetcher, FetchResult
from .models import (
    ChangeType, Event, Notification, RulesConfig, RunRecord, Source, SourceState,
    SourceStatus, SourceType,
)
from .parsers import ParseError, parse
from .parsers.api import api_total
from .scoring import ScoreInput, score
from .store import Store
from .textutil import canonical_url, extract_deadline, match_keywords, short_hash

log = logging.getLogger(__name__)

FAILURE_STATUSES = {SourceStatus.FETCH_ERROR, SourceStatus.PARSE_ERROR, SourceStatus.BLOCKED}
# On quiet days at most one "heartbeat" commit; real changes are always persisted.
HEARTBEAT_INTERVAL = timedelta(hours=20)
GITHUB_REPO_RE = re.compile(r"^https://github\.com/([^/]+)/([^/#?]+)")


@dataclass
class RunSummary:
    run: RunRecord
    new_events: list[Event] = field(default_factory=list)
    persist: bool = False
    persist_reason: str = ""


def github_api_url(source: Source) -> str:
    if source.url.startswith("https://api.github.com/"):
        return source.url
    m = GITHUB_REPO_RE.match(source.url)
    if not m:
        raise ValueError("github_releases 的 url 必须是 https://github.com/<owner>/<repo>[/releases]")
    # Release notes can be huge (MBs per page), so only request what will be kept.
    return f"https://api.github.com/repos/{m.group(1)}/{m.group(2)}/releases?per_page={min(30, source.max_items)}"


def _request_plan(source: Source) -> tuple[str, dict[str, str], bool]:
    """Return (url, headers, check_robots).

    robots.txt governs crawlers of web pages and feeds. Official APIs are governed by
    their own terms of use instead (api.github.com's robots.txt disallows everything
    because the API is not meant for crawlers), so robots is not applied to them.
    """
    if source.type == SourceType.GITHUB_RELEASES:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return github_api_url(source), headers, False
    if source.type == SourceType.API:
        return source.url, {"Accept": "application/json"}, False
    if source.type == SourceType.RSS:
        return source.url, {"Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8"}, True
    return source.url, {"Accept": "text/html,application/xhtml+xml"}, True


class _EmptyFeed(Exception):
    """The feed parsed fine but currently lists no entries."""


def _with_param(url: str, name: str, value: int) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != name] + [(name, str(value))]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _fetch_items(source: Source, fetcher: Fetcher, url: str, headers: dict[str, str], check_robots: bool,
                 prev_snap) -> tuple[FetchResult, list, int | None]:
    """Fetch and parse a source. Returns (last response, items, total reported by the API).

    Paginated APIs are walked page by page (bounded by ``max_pages``); conditional
    requests are only used for single-document sources.
    """
    pag = source.api.pagination if source.type == SourceType.API and source.api else None
    if pag is None:
        res = fetcher.fetch(url, headers=headers, check_robots=check_robots,
                            etag=prev_snap.etag if prev_snap else None,
                            last_modified=prev_snap.last_modified if prev_snap else None)
        if res.not_modified:
            return res, [], None
        items = parse(source, res.text, res.url)
        total = api_total(res.text, source.api) if source.type == SourceType.API and source.api else None
        return res, items, total

    items: list = []
    seen: set[str] = set()
    total: int | None = None
    res: FetchResult | None = None
    for page in range(pag.max_pages):
        res = fetcher.fetch(_with_param(url, pag.offset_param, page * pag.page_size), headers=headers,
                            check_robots=check_robots)
        page_items = parse(source.model_copy(update={"max_items": 2000}), res.text, res.url)
        total = api_total(res.text, source.api) if total is None else total
        for it in page_items:
            if it.key not in seen:  # postings can shift between pages while we read
                seen.add(it.key)
                items.append(it)
        if len(page_items) < pag.page_size or (total is not None and (page + 1) * pag.page_size >= total):
            break
    assert res is not None
    res = FetchResult(url=res.url, status=res.status, text="", content_type=res.content_type)  # no ETag for paged data
    return res, items[: source.max_items], total


def _make_event(source: Source, change: Change, rules: RulesConfig, now: datetime) -> Event:
    item, prev = change.item, change.previous
    title = item.title if item else (prev.title if prev else "")
    url = item.url if item else (prev.url if prev else source.url)
    summary = item.summary if item else (prev.summary if prev else "")
    if change.change_type == ChangeType.MODIFIED and change.diff:
        added = [ln for ln in change.diff["added"] if ln.strip()]
        if added:
            summary = "新增/修改内容：" + " / ".join(added)[:400]
    published = item.published_at if item else (prev.published_at if prev else None)
    extra_text = " ".join(item.extra.values()) if item else ""
    haystack = f"{title}\n{summary}\n{item.text if item else ''}\n{extra_text}"
    groups = rules.keyword_groups
    matched = match_keywords(haystack, source.keywords, groups)
    alerts = match_keywords(haystack, rules.alert_keywords, groups)
    deadline = extract_deadline(haystack)
    diff = change.diff
    if source.profile == "pricing" and change.change_type == ChangeType.MODIFIED and prev and item:
        _, added_prices, removed_prices = price_changed(prev.text, item.text)
        diff = {"added": added_prices, "removed": removed_prices}
        summary = "价格信息变化：" + " / ".join(added_prices)[:400] if added_prices else "部分价格信息被移除"

    pts, level, factors = score(
        ScoreInput(change_type=change.change_type, priority=source.priority, credibility=source.credibility,
                   matched_keywords=tuple(matched), alert_keywords=tuple(alerts),
                   published_at=published, deadline=deadline, minor=change.minor),
        now, rules.levels,
    )
    extra = dict(item.extra) if item else {}
    if change.minor:
        extra["minor"] = "true"
    facets = compute_facets(source, rules, title, f"{summary}\n{item.text if item else ''}", extra)
    if source.profile == "pricing" and change.change_type == ChangeType.INITIAL:
        facets["ai_type_rule"] = "开始监控官方定价页（基线，不代表价格变化）"
    return Event(
        id=short_hash(source.id, change.key, change.change_type.value, change.hash),
        source_id=source.id, source_name=source.name, category=source.category,
        change_type=change.change_type, title=title or "（无标题）", url=url, summary=summary,
        detected_at=now, published_at=published,
        source_updated_at=item.updated_at if item else None,
        matched_keywords=matched, alert_keywords=alerts,
        deadline=deadline.isoformat() if deadline else None,
        score=pts, level=level, score_factors=factors, diff=diff, extra=extra, facets=facets,
    )


def compute_facets(source: Source, rules: RulesConfig, title: str, text: str, extra: dict[str, str]) -> dict[str, str]:
    """Structured facets for profiled sources; only explicit information (see classify.py)."""
    if source.profile == "jobs":
        functions = {name: rules.keyword_groups.get(name, []) for name in rules.job_functions}
        return job_facets(title, text, extra, company=source.company, industry=source.industry,
                          function_groups=functions)
    if source.profile in ("ai", "pricing", "status"):
        return ai_facets(title, text, profile=source.profile, vendor=source.company,
                         is_release=source.type == SourceType.GITHUB_RELEASES)
    return {}


def backfill_facets(events: list[Event], sources: dict[str, Source], rules: RulesConfig) -> int:
    """Give v0.1 events (no facets) the facets of their now-profiled source.

    Derived only from fields already stored on the event, so it never invents data and
    never changes event ids. Returns the number of events updated.
    """
    n = 0
    for e in events:
        src = sources.get(e.source_id)
        if e.facets or src is None or src.profile == "general":
            continue
        facets = compute_facets(src, rules, e.title, e.summary, e.extra)
        if facets:
            e.facets = facets
            n += 1
    return n


def is_price_noise(source: Source, change: Change) -> bool:
    """On pricing pages only a change of price lines is an event; banners/layout are not."""
    if source.profile != "pricing" or change.change_type != ChangeType.MODIFIED:
        return False
    if change.previous is None or change.item is None:
        return False
    changed, _, _ = price_changed(change.previous.text, change.item.text)
    return not changed


def _passes_filters(source: Source, event: Event, groups: dict[str, list[str]]) -> bool:
    text = f"{event.title}\n{event.summary}\n" + " ".join(event.extra.values())
    if source.exclude_keywords and match_keywords(text, source.exclude_keywords, groups):
        return False
    if source.require_keywords and source.keywords and not event.matched_keywords:
        return False
    return True


def run(
    config_dir: Path,
    data_dir: Path,
    *,
    fetcher: Fetcher | None = None,
    now: datetime | None = None,
    trigger: str = "manual",
    only: set[str] | None = None,
) -> RunSummary:
    started = now or datetime.now(UTC)
    sources_cfg = load_sources(config_dir)
    rules = load_rules(config_dir)
    store = Store(data_dir)

    status = store.load_status()
    states: dict[str, SourceState] = status.get("sources", {})
    events = store.load_events()
    backfilled = backfill_facets(events, {s.id: s for s in sources_cfg.sources}, rules)
    known_ids = {e.id for e in events} | store.archived_event_ids()
    # Cross-source / GUID-churn duplicates: same source+URL, or same URL from another source.
    known_urls: dict[str, str] = {}
    for e in events:
        if e.change_type in (ChangeType.ADDED, ChangeType.INITIAL):
            known_urls.setdefault(canonical_url(e.url), e.source_id)

    own_fetcher = fetcher is None
    fetcher = fetcher or Fetcher()
    run_rec = RunRecord(id=started.strftime("%Y%m%dT%H%M%SZ"), started_at=started, finished_at=started, trigger=trigger)
    new_events: list[Event] = []
    system_notes: list[Notification] = []
    content_changed = backfilled > 0

    configured_ids = {s.id for s in sources_cfg.sources}
    if set(states) - configured_ids:
        content_changed = True  # sources removed from config
    states = {k: v for k, v in states.items() if k in configured_ids}

    try:
        for source in sources_cfg.sources:
            if only and source.id not in only:
                continue
            prev_state = states.get(source.id) or SourceState(id=source.id)
            state = prev_state.model_copy()
            run_rec.sources_total += 1

            if not source.enabled:
                state.status, state.message = SourceStatus.PAUSED, "已暂停监控"
                run_rec.sources_paused += 1
                states[source.id] = state
                content_changed |= prev_state.status != state.status
                continue

            now_i = now or datetime.now(UTC)
            state.last_checked_at = now_i
            prev_snap = store.load_snapshot(source.id)
            try:
                url, headers, check_robots = _request_plan(source)
                res, items, total = _fetch_items(source, fetcher, url, headers, check_robots, prev_snap)
                state.http_status = res.status
                if res.not_modified and prev_snap is not None:
                    state.status, state.message = SourceStatus.UNCHANGED, "服务器返回 304：内容未修改"
                    state.item_count = len(prev_snap.items)
                else:
                    if not items and prev_snap and prev_snap.items:
                        if source.type == SourceType.RSS:
                            # A valid but empty feed is normal (e.g. arXiv on weekends): keep the
                            # snapshot, report nothing, and do not treat entries as removed.
                            raise _EmptyFeed()
                        raise ParseError("本次没有解析到任何条目，已保留上次快照（需人工确认）")
                    if suspicious_shrink(prev_snap, items):
                        raise ParseError(
                            f"条目数从 {len(prev_snap.items)} 骤降到 {len(items)}，疑似页面结构变化，"
                            "已保留上次快照（需人工确认）")
                    def eligible(it, _src=source) -> bool:
                        text = f"{it.title}\n{it.summary}\n" + " ".join(it.extra.values())
                        if _src.exclude_keywords and match_keywords(text, _src.exclude_keywords, rules.keyword_groups):
                            return False
                        return not (_src.require_keywords and _src.keywords
                                    and not match_keywords(text, _src.keywords, rules.keyword_groups))

                    result = detect_changes(source, prev_snap, items, now_i, etag=res.etag,
                                            last_modified=res.last_modified, baseline_eligible=eligible)
                    kept = filtered = dupes = 0
                    noise = 0
                    for change in result.changes:
                        if is_price_noise(source, change):
                            noise += 1
                            continue
                        ev = _make_event(source, change, rules, now_i)
                        if ev.id in known_ids:
                            dupes += 1
                            continue
                        if not _passes_filters(source, ev, rules.keyword_groups):
                            filtered += 1
                            continue
                        if change.change_type in (ChangeType.ADDED, ChangeType.INITIAL):
                            cu = canonical_url(ev.url)
                            if cu != canonical_url(source.url) and cu in known_urls:
                                dupes += 1
                                continue
                            known_urls[cu] = source.id
                        known_ids.add(ev.id)
                        new_events.append(ev)
                        kept += 1
                    run_rec.filtered += filtered
                    run_rec.duplicates += dupes
                    state.item_count = len(items)
                    real_changes = len(result.changes) - noise
                    if prev_snap is None:
                        state.status = SourceStatus.OK
                        state.message = f"已建立基线：{len(items)} 个条目，首次收录 {kept} 条"
                    elif real_changes:
                        state.status = SourceStatus.CHANGED
                        state.message = f"发现 {real_changes} 处变化，生成 {kept} 条情报" + (
                            f"，{filtered} 条被规则过滤" if filtered else "") + (f"，{dupes} 条重复已忽略" if dupes else "")
                        state.last_change_at = now_i
                    else:
                        state.status, state.message = SourceStatus.UNCHANGED, f"{len(items)} 个条目，无变化" + (
                            "（页面有改动，但价格信息未变化）" if noise else "")
                    if result.rebaselined:
                        state.message += f"；监控范围已调整，新纳入的 {result.rebaselined} 个条目作为基线，不视为新增"
                    if total is not None and total > len(items):
                        state.message += f"；接口共 {total} 条，本次只获取了 {len(items)} 条"
                    etag_changed = prev_snap is not None and (prev_snap.etag, prev_snap.last_modified) != (res.etag, res.last_modified)
                    if result.content_changed or etag_changed:
                        store.save_snapshot(result.snapshot)
                        content_changed = True
                state.last_success_at = now_i
                state.consecutive_failures = 0
                run_rec.sources_ok += 1
            except _EmptyFeed:
                state.status = SourceStatus.UNCHANGED
                state.message = "订阅源当前没有条目（例如周末不更新），已保留上次快照"
                state.item_count = len(prev_snap.items) if prev_snap else 0
                state.last_success_at = now_i
                state.consecutive_failures = 0
                run_rec.sources_ok += 1
            except FetchError as exc:
                state.status = SourceStatus.BLOCKED if exc.blocked else SourceStatus.FETCH_ERROR
                state.message, state.http_status = str(exc), exc.status
            except ParseError as exc:
                state.status, state.message = SourceStatus.PARSE_ERROR, f"解析失败：{exc}"
            except ValueError as exc:  # e.g. malformed github url
                state.status, state.message = SourceStatus.PARSE_ERROR, f"配置错误：{exc}"

            if state.status in FAILURE_STATUSES:
                state.consecutive_failures = prev_state.consecutive_failures + 1
                run_rec.sources_failed += 1
                run_rec.errors.append({"source_id": source.id, "status": state.status.value, "message": state.message})
                if prev_state.status not in FAILURE_STATUSES:
                    system_notes.append(Notification(
                        id="system-" + short_hash(source.id, now_i.isoformat()), kind="system",
                        created_at=now_i, title=f"信息源异常：{source.name}", body=state.message))
                log.warning("[%s] %s: %s", source.id, state.status.value, state.message)
            else:
                log.info("[%s] %s: %s", source.id, state.status.value, state.message)
            if (prev_state.status, prev_state.message) != (state.status, state.message):
                content_changed = True
            states[source.id] = state
    finally:
        if own_fetcher:
            fetcher.close()

    finished = now or datetime.now(UTC)
    run_rec.finished_at = finished
    run_rec.new_events = len(new_events)

    # ---------------------------------------------------------------- notifications
    notifications = store.load_notifications()
    notified = store.load_notified()
    already = set(notified["event_ids"])
    alerts = notify.select_alerts(new_events, rules, already)
    if alerts:
        notifications.append(notify.build_alert(alerts, finished))
        notified["event_ids"] += [e.id for e in alerts]
    notifications += system_notes

    all_events = events + new_events
    today = notify.local_day(finished, rules.timezone)
    events_today = [e for e in all_events if notify.local_day(e.detected_at, rules.timezone) == today]
    digest_md = None
    if new_events:
        notifications, digest_md = notify.upsert_digest(notifications, today, events_today, rules, finished)
        if digest_md:
            store.write_digest(today, digest_md)

    issue_url = _maybe_issue(rules, new_events, notified, today, digest_md)
    if issue_url:
        notifications.append(Notification(id="system-issue-" + short_hash(issue_url), kind="system",
                                          created_at=finished, title="已创建 GitHub Issue 通知", body=issue_url))

    # ---------------------------------------------------------------- persist
    meaningful = content_changed or bool(new_events) or bool(alerts) or bool(system_notes)
    last_persisted = status.get("last_persisted_at")
    stale = (last_persisted is None or
             finished - datetime.fromisoformat(last_persisted) >= HEARTBEAT_INTERVAL)
    persist = meaningful or stale
    reason = "data-changed" if meaningful else ("daily-heartbeat" if stale else "")

    store.save_events(all_events, finished)
    runs = store.load_runs()
    runs.append(run_rec)
    store.save_runs(runs)
    store.save_notifications(notifications)
    store.save_notified(notified)
    last_ok = status.get("last_successful_run_at")
    if run_rec.sources_ok > 0:
        last_ok = finished.isoformat()
    store.save_status({
        "generated_at": finished.isoformat(),
        "last_run": run_rec,
        "last_successful_run_at": last_ok,
        "last_persisted_at": finished.isoformat() if persist else last_persisted,
        "sources": states,
    })
    return RunSummary(run=run_rec, new_events=new_events, persist=persist, persist_reason=reason)


def _maybe_issue(rules: RulesConfig, new_events: list[Event], notified: dict[str, Any],
                 today: str, digest_md: str | None) -> str | None:
    cfg = rules.github_issue
    if not cfg.enabled or not digest_md:
        return None
    worthy = [e for e in new_events
              if e.change_type != ChangeType.INITIAL and notify.at_least(e.level, cfg.min_level)]
    issued = notified["issues"].get(today, [])
    if not worthy or len(issued) >= cfg.max_issues_per_day:
        return None
    url = notify.create_github_issue(f"知更日报 {today}（{len(worthy)} 条达到提醒级别）", digest_md, cfg.labels)
    if url:
        notified["issues"][today] = issued + [url]
        # keep the issue log bounded
        notified["issues"] = dict(sorted(notified["issues"].items())[-60:])
    return url
