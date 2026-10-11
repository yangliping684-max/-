from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote, urljoin

from ..models import ApiOptions, Item
from ..textutil import clean_html_to_text, truncate


_FILTER_SEG = re.compile(r"^([\w-]*)\[([\w-]+)=([^\]]*)\]$")


def get_path(data: Any, path: str) -> Any:
    """Resolve a dotted path like ``"data.items"`` or ``"location.name"``.

    A segment may select from a list by field value:
    ``"customField[fieldLabel=Position type].valueLabel"``.
    """
    if not path:
        return data
    cur = data
    for part in path.split("."):
        m = _FILTER_SEG.match(part)
        if m:
            key, field, value = m.groups()
            seq = cur.get(key) if key and isinstance(cur, dict) else cur
            if not isinstance(seq, list):
                return None
            cur = next((x for x in seq if isinstance(x, dict) and str(x.get(field)) == value), None)
        elif isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
        if cur is None:
            return None
    return cur


def _load(text: str) -> Any:
    from . import ParseError

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ParseError(f"响应不是有效的 JSON：{exc}") from exc


_PLACEHOLDER = re.compile(r"\{([\w.]+)\}")


def fill_template(template: str, row: dict) -> str | None:
    """Fill "{id}" / "{company.identifier}" from the item; None if any value is missing."""
    missing = False

    def sub(m: re.Match[str]) -> str:
        nonlocal missing
        value = get_path(row, m.group(1))
        if value in (None, ""):
            missing = True
            return ""
        return quote(str(value), safe="")

    out = _PLACEHOLDER.sub(sub, template)
    return None if missing else out


def api_total(text: str, opts: ApiOptions) -> int | None:
    if not opts.total_path:
        return None
    try:
        value = get_path(json.loads(text), opts.total_path)
        return int(value) if value is not None else None
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def parse_api(text: str, opts: ApiOptions, base_url: str) -> list[Item]:
    from . import ParseError, parse_iso_datetime

    data = _load(text)
    rows = get_path(data, opts.items_path)
    if not isinstance(rows, list):
        raise ParseError(f"在路径 '{opts.items_path or '(根)'}' 没有找到条目列表")

    items: list[Item] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = get_path(row, opts.title_field)
        ident = get_path(row, opts.id_field)
        if not title or ident is None:
            continue
        url = get_path(row, opts.url_field)
        if opts.url_template:
            url = fill_template(opts.url_template, row)
        url = url or base_url
        summary = get_path(row, opts.summary_field) if opts.summary_field else ""
        extra = {}
        for name, path in opts.extra_fields.items():
            value = get_path(row, path)
            if value not in (None, "", [], {}):
                extra[name] = truncate(str(value), 200)
        items.append(
            Item(
                key=str(ident),
                title=truncate(clean_html_to_text(str(title)), 300),
                url=urljoin(base_url, str(url)),
                summary=truncate(clean_html_to_text(str(summary or "")), 600),
                published_at=parse_iso_datetime(get_path(row, opts.published_field)) if opts.published_field else None,
                updated_at=parse_iso_datetime(get_path(row, opts.updated_field)) if opts.updated_field else None,
                extra=extra,
            )
        )
    return items


def parse_github_releases(text: str) -> list[Item]:
    """GitHub REST ``GET /repos/{owner}/{repo}/releases``."""
    from . import ParseError, parse_iso_datetime

    data = _load(text)
    if not isinstance(data, list):
        raise ParseError("GitHub Releases 接口返回的不是列表")
    items: list[Item] = []
    for rel in data:
        if not isinstance(rel, dict) or rel.get("draft"):
            continue
        tag = rel.get("tag_name") or ""
        name = rel.get("name") or tag
        if not name:
            continue
        extra = {"tag": tag}
        if rel.get("prerelease"):
            extra["prerelease"] = "true"
        items.append(
            Item(
                key=str(rel.get("id") or tag),
                title=truncate(name if tag in name else f"{name} ({tag})" if tag else name, 300),
                url=rel.get("html_url") or "",
                summary=truncate(clean_html_to_text(rel.get("body") or ""), 600),
                published_at=parse_iso_datetime(rel.get("published_at")),
                extra=extra,
            )
        )
    return items
