"""Snapshot comparison: turn (previous snapshot, current items) into changes."""

from __future__ import annotations

import difflib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from .models import ChangeType, Item, Snapshot, SnapshotItem, Source
from .textutil import content_hash, strip_noise

MAX_SEEN_KEYS = 3000
MAX_DIFF_LINES = 20
MAX_SNAPSHOT_TEXT = 50_000


@dataclass
class Change:
    change_type: ChangeType
    key: str
    item: Item | None  # None for removals
    previous: SnapshotItem | None
    hash: str
    minor: bool = False
    diff: dict[str, list[str]] | None = None


@dataclass
class DiffResult:
    changes: list[Change] = field(default_factory=list)
    snapshot: Snapshot | None = None
    content_changed: bool = False  # snapshot items differ from the previous ones
    rebaselined: int = 0  # items absorbed into the baseline because the scope changed
    rebaselined_keys: set[str] = field(default_factory=set)


def item_hash(item: Item, noise: list[str]) -> str:
    # The URL is part of identity (key), not content: tracking-param churn is ignored.
    return content_hash(item.title, item.summary, item.text, noise=noise)


def line_diff(old: str, new: str, noise: list[str]) -> tuple[dict[str, list[str]], float]:
    old_lines = strip_noise(old, noise).splitlines()
    new_lines = strip_noise(new, noise).splitlines()
    added, removed = [], []
    for line in difflib.ndiff(old_lines, new_lines):
        if line.startswith("+ "):
            added.append(line[2:])
        elif line.startswith("- "):
            removed.append(line[2:])
    ratio = difflib.SequenceMatcher(None, "\n".join(old_lines), "\n".join(new_lines)).ratio()
    return {"added": added[:MAX_DIFF_LINES], "removed": removed[:MAX_DIFF_LINES]}, ratio


def is_minor(diff: dict[str, list[str]], ratio: float) -> bool:
    changed_chars = sum(len(x) for x in diff["added"]) + sum(len(x) for x in diff["removed"])
    return ratio >= 0.97 and changed_chars <= 40


def suspicious_shrink(prev: Snapshot | None, items: list[Item]) -> bool:
    """A list that suddenly loses most entries usually means the page layout changed,
    not that everything was deleted. Such results are rejected instead of producing a
    flood of "removed" events."""
    if prev is None or len(prev.items) < 5:
        return False
    return len(items) < len(prev.items) * 0.2


def _sort_newest_first(items: list[Item]) -> list[Item]:
    if all(i.published_at for i in items):
        return sorted(items, key=lambda i: i.published_at, reverse=True)
    return items  # keep source order (feeds and pages are usually newest first)


# v0.1 allowed at most 500 items per source, so a legacy snapshot that holds 500 items
# was certainly truncated by the cap.
LEGACY_MAX_ITEMS = 500


def scope_of(source: Source) -> str:
    pag = source.api.pagination.model_dump() if source.api and source.api.pagination else None
    return f"{source.url}|{source.max_items}|{pag}"


def scope_changed(source: Source, prev: Snapshot | None) -> bool:
    if prev is None:
        return False
    if prev.scope is None:  # legacy snapshot
        return len(prev.items) >= LEGACY_MAX_ITEMS
    return prev.scope != scope_of(source)


def detect_changes(source: Source, prev: Snapshot | None, items: list[Item], now: datetime,
                   *, etag: str | None = None, last_modified: str | None = None,
                   baseline_eligible: Callable[[Item], bool] | None = None,
                   allow_removals: bool | None = None) -> DiffResult:
    noise = source.ignore_patterns
    current: dict[str, SnapshotItem] = {}
    hashes: dict[str, str] = {}
    for it in items:
        h = item_hash(it, noise)
        hashes[it.key] = h
        current[it.key] = SnapshotItem(title=it.title, url=it.url, hash=h, summary=it.summary,
                                       published_at=it.published_at, text=it.text[:MAX_SNAPSHOT_TEXT])

    seen = list(dict.fromkeys((prev.seen_keys if prev else []) + list(current)))[-MAX_SEEN_KEYS:]
    snapshot = Snapshot(source_id=source.id, taken_at=now, etag=etag, last_modified=last_modified,
                        items=current, seen_keys=seen, scope=scope_of(source))
    result = DiffResult(snapshot=snapshot)

    if prev is None:
        result.content_changed = True
        pool = [it for it in items if baseline_eligible(it)] if baseline_eligible else items
        for it in _sort_newest_first(pool)[: source.baseline_items]:
            result.changes.append(Change(ChangeType.INITIAL, it.key, it, None, hashes[it.key]))
        return result

    prev_seen = set(prev.seen_keys) | set(prev.items)
    result.content_changed = {k: v.hash for k, v in prev.items.items()} != hashes or prev.scope != snapshot.scope
    widened = scope_changed(source, prev)

    for it in items:
        old = prev.items.get(it.key)
        if old is None:
            if it.key in prev_seen:
                continue
            if widened:
                result.rebaselined += 1  # visible only because the monitored scope grew
                result.rebaselined_keys.add(it.key)
            else:
                result.changes.append(Change(ChangeType.ADDED, it.key, it, None, hashes[it.key]))
            continue
        if old.hash == hashes[it.key]:
            continue
        old_text = old.text or f"{old.title}\n{old.summary}"
        new_text = it.text or f"{it.title}\n{it.summary}"
        diff, ratio = line_diff(old_text, new_text, noise)
        if not diff["added"] and not diff["removed"]:
            continue  # only noise differed after normalisation
        result.changes.append(Change(ChangeType.MODIFIED, it.key, it, old, hashes[it.key],
                                     minor=is_minor(diff, ratio), diff=diff))

    if source.removals_tracked if allow_removals is None else allow_removals:
        for key, old in prev.items.items():
            if key not in current:
                result.changes.append(Change(ChangeType.REMOVED, key, None, old, old.hash))
    return result
