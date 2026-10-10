from __future__ import annotations

import calendar
from datetime import UTC, datetime
from urllib.parse import urljoin

import feedparser

from ..models import Item
from ..textutil import clean_html_to_text, truncate


def _struct_to_dt(st) -> datetime | None:
    if not st:
        return None
    try:
        return datetime.fromtimestamp(calendar.timegm(st), tz=UTC)
    except (OverflowError, ValueError, TypeError):
        return None


def parse_feed(text: str, base_url: str) -> list[Item]:
    from . import ParseError

    feed = feedparser.parse(text)
    if feed.bozo and not feed.entries:
        raise ParseError(f"无法解析 RSS/Atom：{feed.get('bozo_exception', 'unknown error')}")
    if not feed.entries and not feed.feed.get("title"):
        raise ParseError("响应中没有找到 RSS/Atom 结构")

    items: list[Item] = []
    for entry in feed.entries:
        link = entry.get("link") or ""
        link = urljoin(base_url, link) if link else base_url
        key = entry.get("id") or entry.get("guid") or link or entry.get("title", "")
        if not key:
            continue
        summary_html = entry.get("summary") or ""
        if not summary_html and entry.get("content"):
            summary_html = entry["content"][0].get("value", "")
        title = clean_html_to_text(entry.get("title", "")) or "（无标题）"
        items.append(
            Item(
                key=str(key),
                title=truncate(title, 300),
                url=link,
                summary=truncate(clean_html_to_text(summary_html), 600),
                # <published>/<pubDate> is the publication date; <updated> is NOT and is
                # stored separately so the UI never presents it as a publish date.
                # dict.get bypasses feedparser's deprecated updated↔published aliasing.
                published_at=_struct_to_dt(dict.get(entry, "published_parsed")),
                updated_at=_struct_to_dt(dict.get(entry, "updated_parsed")),
            )
        )
    return items
