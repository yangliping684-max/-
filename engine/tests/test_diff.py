from datetime import timedelta

from changeradar.diff import detect_changes, suspicious_shrink
from changeradar.models import ChangeType, HtmlOptions, Item, Source
from changeradar.parsers.html import parse_html
from changeradar.parsers.rss import parse_feed

from .conftest import fixture_text

FEED = Source(id="feed", name="feed", type="rss", url="https://example.com/feed.xml", category="ai", baseline_items=2)
PAGE_OPTS = HtmlOptions(selector="#content", ignore_selectors=[".share"])
PAGE = Source(id="page", name="page", type="html", url="https://u.example.edu/p", category="edu", html=PAGE_OPTS)
JOBS_OPTS = HtmlOptions(selector=".jobs", item_selector="li.job", title_selector=".job-title", date_selector="time")
JOBS = Source(id="jobs", name="jobs", type="html", url="https://jobs.example.com/campus", category="jobs", html=JOBS_OPTS)


def feed_items(name):
    return parse_feed(fixture_text(name), FEED.url)


def test_first_run_creates_baseline_limited_to_baseline_items(now):
    res = detect_changes(FEED, None, feed_items("feed_v1.xml"), now)
    assert [c.change_type for c in res.changes] == [ChangeType.INITIAL] * 2
    # newest first by publication date
    assert res.changes[0].item.title == "Example Agent SDK 2.0 发布"
    assert len(res.snapshot.items) == 3


def test_new_entries_are_recorded_separately_and_window_dropouts_are_not_removals(now):
    base = detect_changes(FEED, None, feed_items("feed_v1.xml"), now).snapshot
    res = detect_changes(FEED, base, feed_items("feed_v2.xml"), now + timedelta(days=1))
    added = [c for c in res.changes if c.change_type == ChangeType.ADDED]
    assert sorted(c.item.title for c in added) == ["Open-source model release: Example-LLM 7B",
                                                   "Security advisory for Example CLI"]
    # "Weekly digest #41" fell out of the feed window: not a removal for feeds
    assert not [c for c in res.changes if c.change_type == ChangeType.REMOVED]
    # whitespace-only difference in the SDK entry is not a modification
    assert not [c for c in res.changes if c.change_type == ChangeType.MODIFIED]


def test_identical_rerun_produces_no_changes(now):
    base = detect_changes(FEED, None, feed_items("feed_v1.xml"), now).snapshot
    res = detect_changes(FEED, base, feed_items("feed_v1.xml"), now + timedelta(days=1))
    assert res.changes == []
    assert res.content_changed is False


def test_entry_reappearing_in_window_is_not_new_again(now):
    s1 = detect_changes(FEED, None, feed_items("feed_v1.xml"), now).snapshot
    s2 = detect_changes(FEED, s1, feed_items("feed_v2.xml"), now).snapshot  # weekly-41 gone
    res = detect_changes(FEED, s2, feed_items("feed_v1.xml"), now)  # weekly-41 back
    assert [c for c in res.changes if c.change_type == ChangeType.ADDED] == []


def page_items(name):
    return parse_html(fixture_text(name), PAGE_OPTS, PAGE.url)


def test_layout_and_counter_changes_are_not_content_changes(now):
    base = detect_changes(PAGE, None, page_items("page_v1.html"), now).snapshot
    res = detect_changes(PAGE, base, page_items("page_v1_relayout.html"), now)
    assert res.changes == []
    assert res.content_changed is False


def test_real_page_edit_is_a_modification_with_line_diff(now):
    base = detect_changes(PAGE, None, page_items("page_v1.html"), now).snapshot
    res = detect_changes(PAGE, base, page_items("page_v2.html"), now)
    [change] = res.changes
    assert change.change_type == ChangeType.MODIFIED
    assert change.minor is False
    assert any("10月31日" in ln for ln in change.diff["added"])
    assert any("10月25日" in ln for ln in change.diff["removed"])


def test_tiny_edit_is_flagged_minor(now):
    old = Item(key="page", title="t", url="u", text="第一段很长的正文内容保持不变。\n" * 20 + "联系电话 1234")
    new = Item(key="page", title="t", url="u", text="第一段很长的正文内容保持不变。\n" * 20 + "联系电话 1235")
    base = detect_changes(PAGE, None, [old], now).snapshot
    [change] = detect_changes(PAGE, base, [new], now).changes
    assert change.minor is True


def jobs_items(name):
    return parse_html(fixture_text(name), JOBS_OPTS, JOBS.url)


def test_job_list_tracks_additions_and_removals(now):
    base = detect_changes(JOBS, None, jobs_items("jobs_v1.html"), now).snapshot
    res = detect_changes(JOBS, base, jobs_items("jobs_v2.html"), now)
    by_type = {}
    for c in res.changes:
        by_type.setdefault(c.change_type, []).append(c)
    assert sorted(c.item.title for c in by_type[ChangeType.ADDED]) == ["AI Agent 研发实习生", "产品经理实习生"]
    [removed] = by_type[ChangeType.REMOVED]
    assert removed.previous.title == "数据分析实习生"


def test_removals_can_be_disabled(now):
    src = JOBS.model_copy(update={"track_removals": False})
    base = detect_changes(src, None, jobs_items("jobs_v1.html"), now).snapshot
    res = detect_changes(src, base, jobs_items("jobs_v2.html"), now)
    assert not [c for c in res.changes if c.change_type == ChangeType.REMOVED]


def test_suspicious_shrink(now):
    items = [Item(key=str(i), title=f"t{i}", url="u") for i in range(10)]
    base = detect_changes(JOBS, None, items, now).snapshot
    assert suspicious_shrink(base, items[:1]) is True
    assert suspicious_shrink(base, items[:5]) is False
    assert suspicious_shrink(None, []) is False
