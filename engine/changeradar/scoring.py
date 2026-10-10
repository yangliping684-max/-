"""Explainable rule-based importance scoring.

The score is a *filtering aid*, not an objective judgement: every point is attached to
a human-readable reason (``ScoreFactor``) so the UI can show why an item ranked where it
did. Weights live here in one table so they are easy to audit and tune.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .models import ChangeType, Credibility, Level, LevelThresholds, ScoreFactor

BASE_SCORE = 20

PRIORITY_POINTS = {1: -10, 2: -5, 3: 0, 4: 8, 5: 15}
CREDIBILITY_POINTS = {
    Credibility.OFFICIAL: 10,
    Credibility.RELIABLE: 5,
    Credibility.UNVERIFIED: 0,
    Credibility.LOW: -10,
}
CHANGE_POINTS = {
    ChangeType.ADDED: 15,
    ChangeType.MODIFIED: 8,
    ChangeType.REMOVED: 0,
    ChangeType.INITIAL: -15,
}
MINOR_MODIFICATION_POINTS = -15
KEYWORD_POINTS_EACH = 8
KEYWORD_POINTS_CAP = 16
ALERT_KEYWORD_POINTS = 20
DEADLINE_SOON_DAYS = 14


@dataclass(frozen=True)
class ScoreInput:
    change_type: ChangeType
    priority: int
    credibility: Credibility
    matched_keywords: tuple[str, ...] = ()
    alert_keywords: tuple[str, ...] = ()
    published_at: datetime | None = None
    deadline: date | None = None
    minor: bool = False


def freshness_points(published_at: datetime | None, now: datetime) -> tuple[int, str]:
    if published_at is None:
        return 0, "来源未提供可靠的发布日期，不计新鲜度"
    age = now - published_at
    if age < timedelta(0):
        # Future dates are usually time-zone slop; treat as fresh but say so.
        return 10, "发布日期晚于检测时间（可能是时区差异），按最新处理"
    if age <= timedelta(days=1):
        return 15, "24 小时内发布"
    if age <= timedelta(days=3):
        return 10, "3 天内发布"
    if age <= timedelta(days=7):
        return 5, "7 天内发布"
    if age <= timedelta(days=30):
        return 0, "30 天内发布"
    return -10, "发布时间超过 30 天"


def deadline_points(deadline: date | None, today: date) -> tuple[int, str]:
    if deadline is None:
        return 0, ""
    days = (deadline - today).days
    if days < 0:
        return -10, f"截止日期 {deadline.isoformat()} 已过"
    if days <= DEADLINE_SOON_DAYS:
        return 15, f"距截止日期 {deadline.isoformat()} 还有 {days} 天"
    return 8, f"包含明确截止日期 {deadline.isoformat()}"


def level_for(score: int, thresholds: LevelThresholds) -> Level:
    if score >= thresholds.high:
        return Level.HIGH
    if score >= thresholds.medium:
        return Level.MEDIUM
    return Level.LOW


def score(inp: ScoreInput, now: datetime, thresholds: LevelThresholds) -> tuple[int, Level, list[ScoreFactor]]:
    factors: list[ScoreFactor] = [ScoreFactor(factor="base", points=BASE_SCORE, reason="基础分")]

    def add(name: str, points: int, reason: str) -> None:
        if points or reason:
            factors.append(ScoreFactor(factor=name, points=points, reason=reason))

    add("priority", PRIORITY_POINTS.get(inp.priority, 0), f"信息源优先级 {inp.priority}/5")
    add("credibility", CREDIBILITY_POINTS[inp.credibility], f"来源可信度：{inp.credibility.value}")

    change_label = {ChangeType.ADDED: "新增条目", ChangeType.MODIFIED: "内容修改",
                    ChangeType.REMOVED: "条目被移除", ChangeType.INITIAL: "首次收录（建立基线）"}
    add("change", CHANGE_POINTS[inp.change_type], change_label[inp.change_type])
    if inp.minor and inp.change_type == ChangeType.MODIFIED:
        add("minor", MINOR_MODIFICATION_POINTS, "改动很小，可能只是措辞或格式调整")

    if inp.matched_keywords:
        pts = min(KEYWORD_POINTS_CAP, KEYWORD_POINTS_EACH * len(inp.matched_keywords))
        add("keywords", pts, "命中关注关键词：" + "、".join(inp.matched_keywords))
    if inp.alert_keywords:
        add("alert", ALERT_KEYWORD_POINTS, "命中提醒关键词：" + "、".join(inp.alert_keywords))

    pts, reason = freshness_points(inp.published_at, now)
    add("freshness", pts, reason)
    pts, reason = deadline_points(inp.deadline, now.date())
    if reason:
        add("deadline", pts, reason)

    total = max(0, min(100, sum(f.points for f in factors)))
    return total, level_for(total, thresholds), factors
