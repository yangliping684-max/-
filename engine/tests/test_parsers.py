from datetime import UTC, datetime

import pytest

from changeradar.models import ApiOptions, HtmlOptions, Source
from changeradar.parsers import ParseError, parse
from changeradar.parsers.api import parse_api, parse_github_releases
from changeradar.parsers.html import parse_html
from changeradar.parsers.rss import parse_feed

from .conftest import fixture_text


def test_rss_extracts_items_and_cleans_html():
    items = parse_feed(fixture_text("feed_v1.xml"), "https://example.com/feed.xml")
    assert len(items) == 3
    first = items[0]
    assert first.key == "https://example.com/blog/agent-sdk-2"
    assert first.summary == "新版本支持 MCP 与多 Agent 协作。"
    assert "track()" not in first.summary
    assert first.published_at == datetime(2026, 10, 9, 8, 0, tzinfo=UTC)


def test_atom_keeps_updated_separate_from_published():
    items = parse_feed(fixture_text("atom.xml"), "https://example.com/releases.atom")
    v14, v13 = items
    assert v14.url == "https://example.com/releases/v1.4.0"  # relative link resolved
    assert v14.published_at is None  # only <updated> → never presented as publish date
    assert v14.updated_at == datetime(2026, 10, 9, 10, 0, tzinfo=UTC)
    assert v14.summary == "Faster sync"
    assert v13.published_at == datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def test_non_feed_payload_is_a_parse_error():
    with pytest.raises(ParseError):
        parse_feed(fixture_text("broken.xml"), "https://example.com/feed.xml")


def test_html_list_mode():
    opts = HtmlOptions(selector=".jobs", item_selector="li.job", title_selector=".job-title", date_selector="time")
    items = parse_html(fixture_text("jobs_v1.html"), opts, "https://jobs.example.com/campus")
    assert [i.title for i in items] == ["算法实习生（大模型方向）", "前端开发实习生", "数据分析实习生"]
    assert items[0].url == "https://jobs.example.com/jobs/101"
    assert items[0].published_at == datetime(2026, 10, 1, tzinfo=UTC)
    # "9月25日" has no year → no publication date rather than a guess
    assert items[2].published_at is None


def test_html_page_mode_removes_nav_and_ads():
    opts = HtmlOptions(selector="body", ignore_selectors=[".meta"])
    [item] = parse_html(fixture_text("page_v1.html"), opts, "https://u.example.edu/p")
    assert item.key == "page"
    assert "首页" not in item.text  # <nav> removed
    assert "考研冲刺班" not in item.text  # .ad removed
    assert "报名时间" in item.text
    assert "阅读量" not in item.text


def test_html_missing_selector_is_parse_error():
    with pytest.raises(ParseError, match="没有匹配到内容"):
        parse_html("<html><body><p>x</p></body></html>", HtmlOptions(selector="#gone"), "https://e.com")


def test_html_item_selector_without_matches_is_parse_error():
    with pytest.raises(ParseError, match="没有匹配到任何条目"):
        parse_html(fixture_text("jobs_v1.html"), HtmlOptions(selector=".jobs", item_selector=".nope"), "https://e.com")


def test_api_mapping_skips_malformed_rows():
    opts = ApiOptions(items_path="jobs", title_field="title", url_field="absolute_url",
                      published_field="first_published", extra_fields={"location": "location.name"})
    items = parse_api(fixture_text("greenhouse_jobs.json"), opts, "https://boards.example.com")
    assert [i.key for i in items] == ["501", "502"]
    assert items[0].extra == {"location": "San Francisco, CA"}
    assert items[0].published_at == datetime(2026, 10, 7, 13, 0, tzinfo=UTC)
    assert items[1].published_at is None  # no first_published → unknown, not updated_at


def test_api_wrong_path_is_parse_error():
    with pytest.raises(ParseError, match="没有找到条目列表"):
        parse_api(fixture_text("greenhouse_jobs.json"), ApiOptions(items_path="data"), "https://x")


def test_github_releases_skip_drafts():
    items = parse_github_releases(fixture_text("github_releases.json"))
    assert [i.key for i in items] == ["3003", "3002"]
    assert items[1].extra["prerelease"] == "true"
    assert items[1].title == "Release candidate (v2.1.0-rc.1)"


def test_parse_dispatch_applies_max_items():
    src = Source(id="tt", name="t", type="rss", url="https://example.com/f", category="ai", max_items=2)
    assert len(parse(src, fixture_text("feed_v1.xml"), src.url)) == 2


def test_parser_crash_becomes_parse_error():
    src = Source(id="tt", name="t", type="github_releases", url="https://github.com/a/b", category="ai")
    with pytest.raises(ParseError):
        parse(src, "{not json", src.url)


def test_html_date_text_formats():
    from changeradar.parsers.html import parse_date_text
    assert parse_date_text("Oct. 7, 2025") == datetime(2025, 10, 7, tzinfo=UTC)
    assert parse_date_text("2026年1月3日") == datetime(2026, 1, 3, tzinfo=UTC)
    assert parse_date_text("9月25日") is None
