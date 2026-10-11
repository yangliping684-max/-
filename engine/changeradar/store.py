"""JSON file storage with atomic writes.

Every write goes to a temporary file in the same directory, is fsync'ed and then
``os.replace``'d over the target, so a crash mid-write can never leave a truncated
file behind. Reads that fail validation raise instead of silently starting over —
history must never be wiped because of a bad file.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter

from .models import Event, Notification, RunRecord, Snapshot, SourceState

MAX_ACTIVE_EVENTS = 1000
MAX_RUNS = 90
MAX_NOTIFICATIONS = 200
MAX_NOTIFIED_IDS = 10_000


class StoreError(Exception):
    pass


def atomic_write_json(path: Path, data: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:  # large machine-read files (job catalogs): no indentation
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    json.loads(payload)  # never write something we could not read back
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise StoreError(f"数据文件已损坏，拒绝覆盖：{path}（{exc}）") from exc


def _dump(models: list[BaseModel]) -> list[dict[str, Any]]:
    return [m.model_dump(mode="json") for m in models]


class Store:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.snapshots_dir = self.root / "snapshots"
        self.archive_dir = self.root / "archive"
        self.state_dir = self.root / "state"
        self.digests_dir = self.root / "digests"

    # ------------------------------------------------------------------ status

    def load_status(self) -> dict[str, Any]:
        raw = read_json(self.root / "status.json", {}) or {}
        try:
            raw["sources"] = {k: SourceState.model_validate(v) for k, v in (raw.get("sources") or {}).items()}
        except Exception as exc:
            raise StoreError(f"status.json 结构无效：{exc}") from exc
        return raw

    def save_status(self, status: dict[str, Any]) -> None:
        out = dict(status)
        out["sources"] = {k: v.model_dump(mode="json") for k, v in status["sources"].items()}
        if isinstance(out.get("last_run"), BaseModel):
            out["last_run"] = out["last_run"].model_dump(mode="json")
        atomic_write_json(self.root / "status.json", out)

    # ------------------------------------------------------------------ snapshots

    def load_snapshot(self, source_id: str) -> Snapshot | None:
        raw = read_json(self.snapshots_dir / f"{source_id}.json")
        if raw is None:
            return None
        try:
            return Snapshot.model_validate(raw)
        except Exception as exc:
            raise StoreError(f"快照文件无效：{source_id}（{exc}）") from exc

    def save_snapshot(self, snap: Snapshot) -> None:
        atomic_write_json(self.snapshots_dir / f"{snap.source_id}.json", snap.model_dump(mode="json"))

    # ------------------------------------------------------------------ events

    def load_events(self) -> list[Event]:
        raw = read_json(self.root / "events.json", {"events": []}) or {"events": []}
        try:
            return TypeAdapter(list[Event]).validate_python(raw.get("events", []))
        except Exception as exc:
            raise StoreError(f"events.json 结构无效：{exc}") from exc

    def archived_event_ids(self) -> set[str]:
        ids: set[str] = set()
        if self.archive_dir.exists():
            for f in self.archive_dir.glob("????-??.json"):
                for e in (read_json(f, {}) or {}).get("events", []):
                    ids.add(e.get("id", ""))
        return ids

    def save_events(self, events: list[Event], now: datetime) -> None:
        events = sorted(events, key=lambda e: e.detected_at, reverse=True)
        active, overflow = events[:MAX_ACTIVE_EVENTS], events[MAX_ACTIVE_EVENTS:]
        if overflow:
            by_month: dict[str, list[Event]] = defaultdict(list)
            for e in overflow:
                by_month[e.detected_at.strftime("%Y-%m")].append(e)
            for month, evs in by_month.items():
                path = self.archive_dir / f"{month}.json"
                existing = (read_json(path, {}) or {}).get("events", [])
                known = {e["id"] for e in existing}
                merged = existing + [e.model_dump(mode="json") for e in evs if e.id not in known]
                merged.sort(key=lambda e: e["detected_at"], reverse=True)
                atomic_write_json(path, {"month": month, "events": merged})
            self._write_archive_index()
        atomic_write_json(self.root / "events.json", {"updated_at": now.isoformat(), "events": _dump(active)})

    def _write_archive_index(self) -> None:
        months = []
        for f in sorted(self.archive_dir.glob("????-??.json"), reverse=True):
            months.append({"month": f.stem, "count": len((read_json(f, {}) or {}).get("events", []))})
        atomic_write_json(self.archive_dir / "index.json", {"months": months})

    # ------------------------------------------------------------------ runs / notifications

    def load_runs(self) -> list[RunRecord]:
        raw = read_json(self.root / "runs.json", {"runs": []}) or {"runs": []}
        return TypeAdapter(list[RunRecord]).validate_python(raw.get("runs", []))

    def save_runs(self, runs: list[RunRecord]) -> None:
        runs = sorted(runs, key=lambda r: r.started_at, reverse=True)[:MAX_RUNS]
        atomic_write_json(self.root / "runs.json", {"runs": _dump(runs)})

    def load_notifications(self) -> list[Notification]:
        raw = read_json(self.root / "notifications.json", {"notifications": []}) or {"notifications": []}
        return TypeAdapter(list[Notification]).validate_python(raw.get("notifications", []))

    def save_notifications(self, items: list[Notification]) -> None:
        items = sorted(items, key=lambda n: n.created_at, reverse=True)[:MAX_NOTIFICATIONS]
        atomic_write_json(self.root / "notifications.json", {"notifications": _dump(items)})

    def load_notified(self) -> dict[str, Any]:
        raw = read_json(self.state_dir / "notified.json", {}) or {}
        return {"event_ids": list(raw.get("event_ids", [])), "issues": dict(raw.get("issues", {}))}

    def save_notified(self, state: dict[str, Any]) -> None:
        state = {"event_ids": state["event_ids"][-MAX_NOTIFIED_IDS:], "issues": state["issues"]}
        atomic_write_json(self.state_dir / "notified.json", state)

    def write_digest(self, day: str, markdown: str) -> None:
        self.digests_dir.mkdir(parents=True, exist_ok=True)
        path = self.digests_dir / f"{day}.md"
        tmp = path.with_suffix(".md.tmp")
        tmp.write_text(markdown, encoding="utf-8")
        os.replace(tmp, path)
