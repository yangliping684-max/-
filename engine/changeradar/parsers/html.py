from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from ..models import HtmlOptions, Item
from ..textutil import DATE_PATTERNS, date_from_match, normalize_whitespace, short_hash, truncate

# Always-removed noise: navigation chrome, scripts, ads and similar widgets.
ALWAYS_REMOVE = [
    "script", "style", "noscript", "iframe", "svg", "template", "nav",
    "[aria-hidden=true]", "[hidden]", ".ad", ".ads", ".advert", ".advertisement",
    "[id^=ad-]", "[class*=cookie-]", "[class*=banner-ad]",
]



def _text(node: Tag) -> str:
    # Block-level boundaries become line breaks so page-mode diffs are line based.
    for br in node.find_all("br"):
        br.replace_with("\n")
    # A table row is one line ("Model | $5 / MTok | $25 / MTok") so values keep their labels.
    for tr in node.find_all("tr"):
        cells = [normalize_whitespace(c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
        tr.replace_with("\n" + " | ".join(c for c in cells if c) + "\n")
    return normalize_whitespace(node.get_text("\n", strip=True))


def parse_date_text(text: str) -> datetime | None:
    """Parse a full date (with year) from visible text; None when ambiguous."""
    for pattern, kind in DATE_PATTERNS:
        m = pattern.search(text or "")
        if m:
            d = date_from_match(m, kind)
            return datetime(d.year, d.month, d.day, tzinfo=UTC) if d else None
    return None


def parse_html(text: str, opts: HtmlOptions, base_url: str) -> list[Item]:
    from . import ParseError

    soup = BeautifulSoup(text, "lxml")
    region = soup.select_one(opts.selector)
    if region is None:
        raise ParseError(f"选择器 '{opts.selector}' 没有匹配到内容（页面结构可能已改变）")

    for sel in ALWAYS_REMOVE + opts.ignore_selectors:
        try:
            for node in region.select(sel):
                node.decompose()
        except Exception:  # an invalid user selector must not break the whole source
            raise ParseError(f"无效的忽略选择器：{sel}") from None

    title_tag = soup.find("title")
    page_title = normalize_whitespace(title_tag.get_text()) if title_tag else base_url

    if not opts.item_selector:
        body = _text(region)
        if not body:
            raise ParseError(f"选择器 '{opts.selector}' 匹配到的区域没有文本")
        return [Item(key="page", title=truncate(page_title, 300), url=base_url,
                     summary=truncate(body.replace("\n", " "), 400), text=body)]

    items: list[Item] = []
    for node in region.select(opts.item_selector):
        title_node = node.select_one(opts.title_selector) if opts.title_selector else None
        if opts.link_selector:
            link_node = node.select_one(opts.link_selector)
        elif node.name == "a" and node.get("href"):
            link_node = node  # the item itself is the link (common in card layouts)
        else:
            link_node = node.find("a", href=True)
        if link_node is not None and link_node.name != "a":
            link_node = link_node.find("a", href=True) or link_node
        href = link_node.get("href") if isinstance(link_node, Tag) else None
        # "#section" anchors are kept: they are the only deep link on release-notes pages.
        url = urljoin(base_url, href) if href and href != "#" and not str(href).startswith("javascript:") else base_url

        title = _text(title_node) if title_node else (_text(link_node) if isinstance(link_node, Tag) else "")
        full = _text(node)
        if not title:
            title = full.split("\n", 1)[0] if full else ""
        if not title:
            continue

        published = None
        if opts.date_selector:
            date_node = node.select_one(opts.date_selector)
            if date_node is not None:
                published = parse_date_text(date_node.get("datetime") or _text(date_node))

        summary = ""
        if opts.summary_selector:
            s_node = node.select_one(opts.summary_selector)
            summary = _text(s_node).replace("\n", " ") if s_node else ""
        else:
            summary = full.replace("\n", " ")
            if summary.startswith(title):
                summary = summary[len(title):].strip()

        # Identity: the link when it is item specific, otherwise the title.
        key = url if url != base_url else "title:" + short_hash(title)
        extra = {"date_only": "true"} if published else {}
        items.append(Item(key=key, title=truncate(title, 300), url=url,
                          summary=truncate(summary, 400), published_at=published, extra=extra))

    if not items:
        raise ParseError(f"条目选择器 '{opts.item_selector}' 没有匹配到任何条目（页面结构可能已改变）")
    # Duplicate keys in one page (e.g. the same link twice): keep the first.
    seen: set[str] = set()
    unique = []
    for it in items:
        if it.key not in seen:
            seen.add(it.key)
            unique.append(it)
    return unique
