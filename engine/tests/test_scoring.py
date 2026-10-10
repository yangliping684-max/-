from datetime import date, timedelta

from changeradar.models import ChangeType, Credibility, Level, LevelThresholds
from changeradar.scoring import ScoreInput, deadline_points, freshness_points, score

T = LevelThresholds(high=70, medium=45)


def _score(now, **kw):
    base = dict(change_type=ChangeType.ADDED, priority=3, credibility=Credibility.UNVERIFIED)
    base.update(kw)
    return score(ScoreInput(**base), now, T)


def test_factors_sum_to_score_and_are_explained(now):
    total, level, factors = _score(now, matched_keywords=("Claude",), published_at=now - timedelta(hours=2))
    assert total == sum(f.points for f in factors)
    assert all(f.reason for f in factors)
    assert {f.factor for f in factors} >= {"base", "change", "keywords", "freshness"}


def test_official_high_priority_fresh_keyword_hit_is_high(now):
    total, level, _ = _score(now, priority=5, credibility=Credibility.OFFICIAL, matched_keywords=("Claude",),
                             published_at=now - timedelta(hours=1))
    assert level == Level.HIGH and total >= 70


def test_baseline_items_rank_low(now):
    total, level, _ = _score(now, change_type=ChangeType.INITIAL, published_at=now - timedelta(days=60))
    assert level == Level.LOW


def test_minor_modification_ranks_below_major(now):
    major, *_ = _score(now, change_type=ChangeType.MODIFIED)
    minor, *_ = _score(now, change_type=ChangeType.MODIFIED, minor=True)
    assert minor < major


def test_alert_keyword_boosts(now):
    plain, *_ = _score(now)
    alert, *_ = _score(now, alert_keywords=("实习",))
    assert alert - plain == 20


def test_keyword_points_are_capped(now):
    two, *_ = _score(now, matched_keywords=("a", "b"))
    five, *_ = _score(now, matched_keywords=("a", "b", "c", "d", "e"))
    assert two == five


def test_score_is_clamped(now):
    total, *_ = _score(now, priority=1, credibility=Credibility.LOW, change_type=ChangeType.INITIAL,
                       published_at=now - timedelta(days=400), deadline=now.date() - timedelta(days=3))
    assert total == 0


def test_unknown_publish_date_is_neutral(now):
    pts, reason = freshness_points(None, now)
    assert pts == 0 and "未提供" in reason


def test_deadline_points():
    today = date(2026, 10, 10)
    assert deadline_points(None, today) == (0, "")
    assert deadline_points(date(2026, 10, 15), today)[0] == 15
    assert deadline_points(date(2026, 12, 15), today)[0] == 8
    assert deadline_points(date(2026, 10, 1), today)[0] == -10


def test_thresholds_are_configurable(now):
    total, _, _ = _score(now)
    _, level, _ = score(ScoreInput(change_type=ChangeType.ADDED, priority=3, credibility=Credibility.UNVERIFIED),
                        now, LevelThresholds(high=total, medium=0))
    assert level == Level.HIGH
