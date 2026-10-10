"""Notifications: in-site notification center, daily digest and optional GitHub Issues.

Anti-spam guarantees:
* every event is alerted at most once (ids persisted in ``data/state/notified.json``);
* all alerts of one run are batched into a single notification;
* at most ``max_alerts_per_run`` events per alert, ``max_issues_per_day`` issues per day;
* one digest per local day, updated in place when the monitor runs again that day;
* source failures notify on the transition into failure, not on every failing run.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from .models import ChangeType, Event, Level, Notification, RulesConfig
from .textutil import short_hash

log = logging.getLogger(__name__)

LEVEL_ORDER = {Level.LOW: 0, Level.MEDIUM: 1, Level.HIGH: 2}
LEVEL_LABEL = {Level.HIGH: "重要", Level.MEDIUM: "关注", Level.LOW: "一般"}
CHANGE_LABEL = {ChangeType.ADDED: "新增", ChangeType.MODIFIED: "修改",
                ChangeType.REMOVED: "移除", ChangeType.INITIAL: "首次收录"}


def at_least(level: Level, minimum: Level) -> bool:
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum]


def local_day(dt: datetime, tz: str) -> str:
    return dt.astimezone(ZoneInfo(tz)).date().isoformat()


def select_alerts(new_events: list[Event], rules: RulesConfig, already: set[str]) -> list[Event]:
    """Events worth an immediate alert: above threshold or hitting an alert keyword.

    Baseline ("首次收录") items never alert: they are not news, just the starting point.
    """
    picked = [
        e for e in new_events
        if e.change_type != ChangeType.INITIAL
        and e.id not in already
        and (e.score >= rules.importance_threshold or e.alert_keywords)
    ]
    picked.sort(key=lambda e: e.score, reverse=True)
    return picked[: rules.max_alerts_per_run]


def build_alert(events: list[Event], now: datetime) -> Notification:
    top = events[0]
    title = (f"{len(events)} 条情报达到提醒条件" if len(events) > 1 else f"新情报：{top.title}")
    body = "\n".join(f"- [{LEVEL_LABEL[e.level]}·{e.score}] {e.title}（{e.source_name}）" for e in events)
    return Notification(id="alert-" + short_hash(now.isoformat(), *[e.id for e in events]),
                        kind="alert", created_at=now, title=title, body=body,
                        event_ids=[e.id for e in events],
                        level=max((e.level for e in events), key=lambda lv: LEVEL_ORDER[lv]))


def digest_markdown(day: str, events: list[Event], rules: RulesConfig) -> str:
    news = [e for e in events if e.change_type != ChangeType.INITIAL and at_least(e.level, rules.digest.min_level)]
    baseline = [e for e in events if e.change_type == ChangeType.INITIAL]
    news.sort(key=lambda e: e.score, reverse=True)
    lines = [f"# 知更日报 {day}", ""]
    if not news:
        lines.append("今天没有新的变化。")
    else:
        lines.append(f"共发现 **{len(news)}** 条变化（按规则评分排序，评分仅用于辅助筛选）：")
        lines.append("")
        for e in news[: rules.digest.max_items]:
            kw = f" · 关键词：{'、'.join(e.matched_keywords + e.alert_keywords)}" if (e.matched_keywords or e.alert_keywords) else ""
            dl = f" · 截止：{e.deadline}" if e.deadline else ""
            lines.append(f"- **[{LEVEL_LABEL[e.level]} {e.score}]** [{e.title}]({e.url}) — "
                         f"{e.source_name} · {CHANGE_LABEL[e.change_type]}{dl}{kw}")
        if len(news) > rules.digest.max_items:
            lines.append(f"- …以及另外 {len(news) - rules.digest.max_items} 条，请在情报中心查看。")
    if baseline:
        lines += ["", f"另有 {len(baseline)} 条为新信息源建立基线时的首次收录内容。"]
    return "\n".join(lines) + "\n"


def upsert_digest(notifications: list[Notification], day: str, events_today: list[Event],
                  rules: RulesConfig, now: datetime) -> tuple[list[Notification], str | None]:
    if not rules.digest.enabled or not events_today:
        return notifications, None
    md = digest_markdown(day, events_today, rules)
    news = [e for e in events_today if e.change_type != ChangeType.INITIAL]
    digest_id = f"digest-{day}"
    note = Notification(
        id=digest_id, kind="digest", created_at=now,
        title=f"每日摘要 {day}：{len(news)} 条变化" + (f"，{len(events_today) - len(news)} 条首次收录" if len(news) != len(events_today) else ""),
        body=md, event_ids=[e.id for e in events_today],
        level=max((e.level for e in news), key=lambda lv: LEVEL_ORDER[lv], default=Level.LOW),
    )
    others = [n for n in notifications if n.id != digest_id]
    return others + [note], md


# --------------------------------------------------------------------------- GitHub Issues


def create_github_issue(title: str, body: str, labels: list[str]) -> str | None:
    """Create an issue in the current repository using the Actions-provided token.

    Requires ``GITHUB_TOKEN`` and ``GITHUB_REPOSITORY`` (set automatically inside GitHub
    Actions) plus ``issues: write`` permission. Returns the issue URL or None.
    """
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        log.info("GitHub Issue 通知已启用，但缺少 GITHUB_TOKEN / GITHUB_REPOSITORY，跳过")
        return None
    try:
        resp = httpx.post(
            f"https://api.github.com/repos/{repo}/issues",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28"},
            json={"title": title, "body": body, "labels": labels},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json().get("html_url")
    except httpx.HTTPError as exc:
        log.warning("创建 GitHub Issue 失败：%s", exc)
        return None
