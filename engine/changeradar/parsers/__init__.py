"""Parsers turn a fetched payload into a list of :class:`~changeradar.models.Item`."""

from __future__ import annotations

from datetime import UTC, datetime

from ..models import Item, Source, SourceType
from .api import parse_api, parse_github_releases
from .html import parse_html
from .rss import parse_feed


class ParseError(Exception):
    """The payload was fetched but could not be turned into meaningful items."""


def parse(source: Source, text: str, base_url: str) -> list[Item]:
    try:
        if source.type == SourceType.RSS:
            items = parse_feed(text, base_url)
        elif source.type == SourceType.GITHUB_RELEASES:
            items = parse_github_releases(text)
        elif source.type == SourceType.API:
            assert source.api is not None
            items = parse_api(text, source.api, base_url)
        else:
            assert source.html is not None
            items = parse_html(text, source.html, base_url)
    except ParseError:
        raise
    except Exception as exc:  # any parser crash is a parse error, never a silent success
        raise ParseError(f"{type(exc).__name__}: {exc}") from exc
    return items[: source.max_items]


def parse_iso_datetime(value: object) -> datetime | None:
    """Parse ISO-8601 strings / unix timestamps into aware UTC datetimes; None if unsure."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            ts = value / 1000 if value > 1e12 else value
            return datetime.fromtimestamp(ts, tz=UTC)
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


__all__ = ["ParseError", "parse", "parse_iso_datetime"]
