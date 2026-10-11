"""Source research helper: inspect a candidate URL before adding it as a source.

    python -m changeradar probe <url> [--selector CSS ...] [--json-path a.b]

Reports, without bypassing anything: robots.txt verdict, HTTP status, final URL,
content type, whether it is a feed / JSON / HTML, feeds advertised by the page
(<link rel="alternate">), a JavaScript-rendering heuristic and CSS selector match counts.
The goal is evidence: a source is only added after a probe shows it works.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from urllib.parse import urljoin

import feedparser
from bs4 import BeautifulSoup

from .fetcher import FetchError, Fetcher
from .parsers.api import get_path
from .textutil import normalize_whitespace, truncate


@dataclass
class ProbeReport:
    url: str
    robots_allowed: bool | None = None
    status: int | None = None
    final_url: str = ""
    content_type: str = ""
    bytes: int = 0
    kind: str = "unknown"  # feed | json | html | error
    error: str = ""
    blocked: bool = False
    title: str = ""
    feed_entries: int = 0
    feed_samples: list[str] = field(default_factory=list)
    json_top_keys: list[str] = field(default_factory=list)
    json_list_len: int | None = None
    advertised_feeds: list[str] = field(default_factory=list)
    text_chars: int = 0
    script_tags: int = 0
    likely_js_rendered: bool = False
    selectors: dict[str, dict] = field(default_factory=dict)
    links_sample: list[str] = field(default_factory=list)
    json_sample: str = ""  # first part of the (sub)document, for field mapping
    dump: str = ""  # outer HTML of the first match of `dump_selector`
    followed: list[dict] = field(default_factory=list)  # probes of URLs built from this payload
    ats_hints: dict[str, list[str]] = field(default_factory=dict)  # recruiting systems referenced by the page


def probe(url: str, *, fetcher: Fetcher | None = None, **kw) -> ProbeReport:
    if fetcher is not None:
        return _probe(url, fetcher=fetcher, **kw)
    own = Fetcher(retries=2)
    try:
        return _probe(url, fetcher=own, **kw)
    finally:
        own.close()


def _probe(url: str, *, selectors: list[str] | None = None, json_path: str = "",
          fetcher: Fetcher, check_robots: bool = True, dump_selector: str = "",
          follow_template: str = "") -> ProbeReport:
    rep = ProbeReport(url=url)
    try:
        if check_robots:
            rep.robots_allowed = fetcher.allowed_by_robots(url)
        res = fetcher.fetch(url, check_robots=check_robots)
    except FetchError as exc:
        rep.kind, rep.error, rep.blocked, rep.status = "error", str(exc), exc.blocked, exc.status
        return rep

    rep.status, rep.final_url, rep.content_type, rep.bytes = res.status, res.url, res.content_type, len(res.text)
    text = res.text
    ctype = res.content_type.lower()

    if "json" in ctype or text.lstrip()[:1] in "[{":
        try:
            data = json.loads(text)
            rep.kind = "json"
            node = get_path(data, json_path) if json_path else data
            rep.json_sample = json.dumps(data if not isinstance(data, dict) else
                                         {k: v for k, v in data.items() if not isinstance(v, list)} | {"…": "lists omitted"},
                                         ensure_ascii=False)[:600] + "\n" + json.dumps(
                node[0] if isinstance(node, list) and node else node, ensure_ascii=False)[:2500]
            if follow_template:
                from .parsers.api import fill_template
                target = fill_template(follow_template, data)
                if target:
                    sub = _probe(target, fetcher=fetcher, check_robots=True)
                    rep.followed.append({"url": target, "status": sub.status, "final_url": sub.final_url,
                                         "kind": sub.kind, "title": sub.title, "error": sub.error,
                                         "robots_allowed": sub.robots_allowed})
            if isinstance(node, dict):
                rep.json_top_keys = list(node)[:30]
            if isinstance(node, list):
                rep.json_list_len = len(node)
                if node and isinstance(node[0], dict):
                    rep.json_top_keys = list(node[0])[:30]
            return rep
        except json.JSONDecodeError:
            pass

    feed = feedparser.parse(text)
    if feed.entries and ("xml" in ctype or "rss" in ctype or "atom" in ctype or text.lstrip().startswith("<?xml")):
        rep.kind = "feed"
        rep.title = feed.feed.get("title", "")
        rep.feed_entries = len(feed.entries)
        rep.feed_samples = [truncate(e.get("title", ""), 90) for e in feed.entries[:5]]
        return rep

    rep.kind = "html"
    from .research import ats_hints
    rep.ats_hints = ats_hints(text)
    soup = BeautifulSoup(text, "lxml")
    rep.title = normalize_whitespace(soup.title.get_text()) if soup.title else ""
    for link in soup.find_all("link", rel=lambda v: v and "alternate" in v):
        t = (link.get("type") or "").lower()
        if "rss" in t or "atom" in t or "feed" in t:
            rep.advertised_feeds.append(urljoin(res.url, link.get("href", "")))
    rep.script_tags = len(soup.find_all("script"))
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    body_text = normalize_whitespace(soup.get_text("\n", strip=True))
    rep.text_chars = len(body_text)
    # Little visible text but lots of script → content is rendered client-side.
    rep.likely_js_rendered = rep.text_chars < 600 and rep.script_tags >= 3
    anchors = [a for a in soup.find_all("a", href=True) if len(normalize_whitespace(a.get_text())) >= 6]
    rep.links_sample = [truncate(normalize_whitespace(a.get_text(" ")), 60) + " → " + urljoin(res.url, a["href"])
                        for a in anchors[:25]]
    if dump_selector:
        node = soup.select_one(dump_selector)
        rep.dump = str(node)[:20000] if node else "(no match)"
    for sel in selectors or []:
        try:
            nodes = soup.select(sel)
        except Exception as exc:  # invalid selector
            rep.selectors[sel] = {"error": str(exc)}
            continue
        rep.selectors[sel] = {
            "matches": len(nodes),
            "samples": [truncate(normalize_whitespace(n.get_text(" ", strip=True)), 100) for n in nodes[:5]],
            "hrefs": [urljoin(res.url, a["href"]) for n in nodes[:5] for a in ([n] if n.name == "a" and n.get("href") else n.find_all("a", href=True)[:1])],
        }
    return rep


def report_json(rep: ProbeReport) -> str:
    return json.dumps(asdict(rep), ensure_ascii=False, indent=2)
