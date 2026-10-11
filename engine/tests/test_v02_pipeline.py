"""v0.2 pipeline behaviour: pricing gate, pagination, url templates, scope, backfill, compat."""

import json
from datetime import timedelta
from pathlib import Path

import pytest

from changeradar.diff import LEGACY_MAX_ITEMS, detect_changes, scope_of
from changeradar.models import ChangeType, Event, HtmlOptions, Item, Snapshot, SnapshotItem, Source
from changeradar.parsers.api import get_path
from changeradar.parsers.html import parse_html
from changeradar.pipeline import run
from changeradar.store import Store

from .conftest import fixture_text, write_config

REPO = Path(__file__).resolve().parents[2]

PRICING = {"id": "price-page", "name": "定价页", "type": "html", "url": "https://p.example.com/pricing",
           "category": "ai", "profile": "pricing", "company": "Example", "baseline_items": 1,
           "html": {"selector": "main"}}
SR_URL = "https://api.example.com/v1/companies/ExampleCo/postings?country=cn&limit=2"
JOBS = {"id": "sr-jobs", "name": "示例公司职位", "type": "api", "url": SR_URL, "category": "jobs",
        "profile": "jobs", "company": "Example Co", "industry": "制造业",
        "keywords": ["采购", "物料控制"], "require_keywords": True, "max_items": 2000, "baseline_items": 10,
        "api": {"items_path": "content", "title_field": "name",
                "url_template": "https://jobs.example.com/ExampleCo/{id}", "published_field": "releasedDate",
                "total_path": "totalFound", "pagination": {"page_size": 2, "max_pages": 5},
                "extra_fields": {"location": "location.fullLocation", "employment_type": "typeOfEmployment.label",
                                 "position_type": "customField[fieldLabel=Position type].valueLabel"}}}
RULES = {"keyword_groups": {"采购": ["purchasing", "procurement"], "物料控制": ["物料计划", "material planning"]},
         "job_functions": ["采购", "物料控制"]}


@pytest.fixture
def dirs(tmp_path):
    return tmp_path / "config", tmp_path / "data"


def test_pricing_page_only_reports_real_price_changes(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [PRICING])
    url = PRICING["url"]
    web.set(url, fixture_text("pricing_v1.html"))
    s1 = run(config, data, fetcher=fetcher, now=now)
    assert [e.change_type for e in s1.new_events] == [ChangeType.INITIAL]

    web.set(url, fixture_text("pricing_v1_noise.html"))  # banner + re-order, same prices
    s2 = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert s2.new_events == []
    st = json.loads((data / "status.json").read_text())["sources"]["price-page"]
    assert st["status"] == "unchanged" and "价格信息未变化" in st["message"]

    web.set(url, fixture_text("pricing_v2.html"))
    s3 = run(config, data, fetcher=fetcher, now=now + timedelta(days=2))
    [ev] = s3.new_events
    assert ev.change_type == ChangeType.MODIFIED and ev.facets["ai_type"] == "pricing"
    assert any("$4 / mtok" in x for x in ev.diff["added"]) and any("$5 / mtok" in x for x in ev.diff["removed"])
    assert ev.summary.startswith("价格信息变化")


def test_paginated_api_with_url_template_filters_and_facets(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [JOBS], RULES)
    web.set(SR_URL + "&offset=0", fixture_text("smartrecruiters_p1.json"), content_type="application/json")
    web.set(SR_URL + "&offset=2", fixture_text("smartrecruiters_p2.json"), content_type="application/json")
    s = run(config, data, fetcher=fetcher, now=now)
    st = json.loads((data / "status.json").read_text())["sources"]["sr-jobs"]
    assert st["item_count"] == 3 and "只获取" not in st["message"]
    # Baseline picks the newest *matching* postings; the sales job never qualifies.
    by_url = {e.url: e for e in s.new_events}
    assert set(by_url) == {"https://jobs.example.com/ExampleCo/1001", "https://jobs.example.com/ExampleCo/1003"}
    intern = by_url["https://jobs.example.com/ExampleCo/1003"]
    assert intern.facets["job_type"] == "实习" and intern.facets["job_type_rule"] == "来源字段"
    assert intern.facets["grad_year"] == "2027" and intern.facets["city"] == "Wuxi"
    assert intern.facets["function"] == "物料控制" and intern.facets["industry"] == "制造业"
    buyer = by_url["https://jobs.example.com/ExampleCo/1001"]
    assert "grad_year" not in buyer.facets and "education" not in buyer.facets  # 未提供, not invented


def test_truncated_api_is_reported(dirs, web, fetcher, now):
    config, data = dirs
    src = {**JOBS, "api": {**JOBS["api"], "pagination": {"page_size": 2, "max_pages": 1}}}
    write_config(config, [src], RULES)
    web.set(SR_URL + "&offset=0", fixture_text("smartrecruiters_p1.json"), content_type="application/json")
    run(config, data, fetcher=fetcher, now=now)
    st = json.loads((data / "status.json").read_text())["sources"]["sr-jobs"]
    assert "接口共 3 条，本次只获取了 2 条" in st["message"]


def test_get_path_list_filter():
    row = {"customField": [{"fieldLabel": "A", "valueLabel": "x"}, {"fieldLabel": "Position type", "valueLabel": "y"}]}
    assert get_path(row, "customField[fieldLabel=Position type].valueLabel") == "y"
    assert get_path(row, "customField[fieldLabel=Missing].valueLabel") is None


def test_card_that_is_itself_a_link():
    opts = HtmlOptions(selector="main", item_selector="a[href]:has(time)", title_selector="[class*=title]",
                       date_selector="time", summary_selector="p")
    items = parse_html(fixture_text("card_links.html"), opts, "https://www.example.com/news")
    assert [i.url for i in items] == ["https://www.example.com/claude-model-x", "https://www.example.com/news/policy-update"]
    assert items[0].summary == "Our fastest model yet." and items[0].published_at.day == 7


def test_table_rows_become_single_lines():
    [item] = parse_html(fixture_text("pricing_v1.html"), HtmlOptions(selector="main"), "https://p.example.com")
    assert "Example Large | $5 / MTok | $25 / MTok" in item.text


def _items(n):
    return [Item(key=str(i), title=f"job {i}", url=f"https://e.com/{i}") for i in range(n)]


def test_scope_growth_rebaselines_instead_of_reporting_new(now):
    src = Source(id="jobs-x", name="x", type="rss", url="https://e.com/f", category="ai", max_items=2000)
    legacy = Snapshot(source_id="jobs-x", taken_at=now, items={
        str(i): SnapshotItem(title=f"job {i}", url=f"https://e.com/{i}", hash="h") for i in range(LEGACY_MAX_ITEMS)})
    # rehash so the existing 500 are unchanged
    base = detect_changes(src, None, _items(LEGACY_MAX_ITEMS), now).snapshot
    legacy.items = base.items
    res = detect_changes(src, legacy, _items(LEGACY_MAX_ITEMS + 30), now)
    assert res.changes == [] and res.rebaselined == 30
    # Next run with the same scope: genuinely new items are reported again.
    res2 = detect_changes(src, res.snapshot, _items(LEGACY_MAX_ITEMS + 31), now)
    assert [c.change_type for c in res2.changes] == [ChangeType.ADDED] and res2.rebaselined == 0
    assert res.snapshot.scope == scope_of(src)


def test_small_legacy_snapshot_is_not_rebaselined(now):
    src = Source(id="feed-x", name="x", type="rss", url="https://e.com/f", category="ai")
    legacy = detect_changes(src, None, _items(3), now).snapshot.model_copy(update={"scope": None})
    res = detect_changes(src, legacy, _items(4), now)
    assert [c.change_type for c in res.changes] == [ChangeType.ADDED]


def test_v01_events_get_facets_backfilled_without_new_ids(dirs, web, fetcher, now):
    config, data = dirs
    data.mkdir(parents=True)
    old = {"id": "abc123", "source_id": "sr-jobs", "source_name": "x", "category": "jobs", "change_type": "initial",
           "title": "Procurement Intern", "url": "https://jobs.example.com/1", "summary": "", "detected_at": now.isoformat(),
           "published_at": None, "source_updated_at": None, "matched_keywords": [], "alert_keywords": [], "deadline": None,
           "score": 10, "level": "low", "score_factors": [], "diff": None, "extra": {"location": "Shanghai, China"}}
    (data / "events.json").write_text(json.dumps({"events": [old]}))  # v0.1 format: no "facets" key
    write_config(config, [{**JOBS, "enabled": False}], RULES)
    s = run(config, data, fetcher=fetcher, now=now)
    [ev] = Store(data).load_events()
    assert ev.id == "abc123" and ev.facets["job_type"] == "实习" and ev.facets["city"] == "Shanghai"
    assert ev.facets["function"] == "采购"
    assert s.persist


@pytest.mark.skipif(not (REPO / "data" / "events.json").exists(), reason="no committed data")
def test_real_committed_v01_data_loads_with_v02_models():
    """Backward compatibility with the data the live site already has."""
    store = Store(REPO / "data")
    events = store.load_events()
    assert all(isinstance(e, Event) for e in events)
    store.load_status()
    store.load_runs()
    store.load_notifications()
    for f in (REPO / "data" / "snapshots").glob("*.json"):
        assert store.load_snapshot(f.stem) is not None


EMPTY_FEED = """<?xml version="1.0"?><rss version="2.0"><channel><title>cs.AI updates</title>
<link>https://example.org</link><description>No announcements today</description></channel></rss>"""


def test_empty_feed_is_not_a_failure_and_keeps_snapshot(dirs, web, fetcher, now):
    """Regression (found on a real runner): arXiv's feed is empty on weekends."""
    config, data = dirs
    src = {"id": "weekend-feed", "name": "f", "type": "rss", "url": "https://example.org/rss", "category": "ai"}
    write_config(config, [src])
    web.set(src["url"], fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    before = (data / "snapshots" / "weekend-feed.json").read_text()
    web.set(src["url"], EMPTY_FEED)
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    st = json.loads((data / "status.json").read_text())["sources"]["weekend-feed"]
    assert st["status"] == "unchanged" and "没有条目" in st["message"] and s.run.sources_failed == 0
    assert (data / "snapshots" / "weekend-feed.json").read_text() == before
    # Entries come back on Monday: nothing is re-reported as new.
    web.set(src["url"], fixture_text("feed_v1.xml"))
    assert run(config, data, fetcher=fetcher, now=now + timedelta(days=2)).new_events == []


def test_empty_html_list_is_still_suspicious(dirs, web, fetcher, now):
    config, data = dirs
    src = {"id": "list-page", "name": "l", "type": "html", "url": "https://example.org/jobs", "category": "jobs",
           "html": {"selector": ".jobs", "item_selector": "li.job", "title_selector": ".job-title"}}
    write_config(config, [src])
    web.set(src["url"], fixture_text("jobs_v1.html"))
    run(config, data, fetcher=fetcher, now=now)
    web.set(src["url"], "<html><body><div class='jobs'><ul></ul></div></body></html>")
    run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert json.loads((data / "status.json").read_text())["sources"]["list-page"]["status"] == "parse_error"


def test_heading_anchor_items_get_deep_links():
    html = "<main><h2>October</h2><h3 id='a'><a href='#grok-x'>Grok X</a></h3><h3><a href='#'>Bare</a></h3></main>"
    items = parse_html(html, HtmlOptions(selector="main", item_selector="h3"), "https://docs.example.com/notes")
    assert items[0].url == "https://docs.example.com/notes#grok-x"
    assert items[1].url == "https://docs.example.com/notes"


def test_ai_type_does_not_treat_customer_stories_as_launches():
    from changeradar.classify import ai_facets
    story = "Asana cuts model costs 76x in browser tests with GPT-6.1 Sol"
    assert ai_facets(story, "", profile="ai")["ai_type"] != "new_model"
    assert ai_facets("Grok 4.7", "", profile="ai")["ai_type"] == "new_model"
    assert ai_facets("grok-voice-transcribe-1.0 end of life", "", profile="ai")["ai_type"] == "api_change"


def test_structured_api_fields_count_for_keywords(dirs, web, fetcher, now):
    """Baseline eligibility and event keyword filters must look at the same text."""
    config, data = dirs
    src = {**JOBS, "keywords": ["物流"], "api": {**JOBS["api"], "extra_fields": {**JOBS["api"]["extra_fields"],
                                                                                 "function": "function.label"}}}
    write_config(config, [src], {"keyword_groups": {"物流": ["logistics"]}})
    web.set(SR_URL + "&offset=0", fixture_text("smartrecruiters_p1.json"), content_type="application/json")
    web.set(SR_URL + "&offset=2", fixture_text("smartrecruiters_p2.json"), content_type="application/json")
    s = run(config, data, fetcher=fetcher, now=now)
    # Only posting 1003 has function "Logistics" (title doesn't say it) and it is kept.
    assert [e.url for e in s.new_events] == ["https://jobs.example.com/ExampleCo/1003"]
    assert s.run.filtered == 0


def test_pricing_baseline_is_not_described_as_a_price_change(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [PRICING])
    web.set(PRICING["url"], fixture_text("pricing_v1.html"))
    [ev] = run(config, data, fetcher=fetcher, now=now).new_events
    assert "基线" in ev.facets["ai_type_rule"]
