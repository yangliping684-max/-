"""Current-openings catalog for job sources — separate from change events.

Events (``events.json``) answer "what changed?" and drive alerts. The catalog answers
"what is open right now?" and powers search. Rules:

* Every successful check rewrites the source's catalog from the full item list (all
  pages), keyed by the posting's stable id, keeping each job's ``first_seen``.
* A job disappears from the catalog only when the fetch is known to be complete
  (``complete``). Otherwise jobs from earlier runs are kept and the source is flagged
  "数据不完整".
* A failed check never touches the catalog.
* Jobs present when a catalog is first built, or that became visible only because the
  monitored scope grew, are marked ``baseline`` — they are not "new" openings.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .models import Item, Source
from .store import atomic_write_json, read_json

CATALOG_DIR = "jobs"


def job_uid(source_id: str, key: str) -> str:
    return f"{source_id}:{key}"


def _record(source: Source, item: Item, facets: dict[str, str]) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "id": item.key,
        "title": item.title,
        "url": item.url,
        "published_at": item.published_at.isoformat() if item.published_at else None,
    }
    for k in ("company", "location", "city", "industry", "job_type", "job_type_rule", "education", "grad_year", "function"):
        if facets.get(k):
            rec[k] = facets[k]
    for k in ("region", "country", "employment_type", "experience_level", "department", "position_type"):
        if item.extra.get(k):
            rec[k] = item.extra[k]
    if item.extra.get("date_only") == "true":
        rec["date_only"] = True
    return rec


class Catalog:
    def __init__(self, data_dir: Path):
        self.dir = Path(data_dir) / CATALOG_DIR

    def path(self, source_id: str) -> Path:
        return self.dir / f"{source_id}.json"

    def load(self, source_id: str) -> dict[str, Any] | None:
        return read_json(self.path(source_id))

    def update(self, source: Source, items: list[Item], facets_of, now: datetime, *, complete: bool,
               total: int | None, absorbed_keys: set[str] | None = None) -> tuple[dict[str, Any], dict[str, int]]:
        """Rebuild a source's catalog. Returns (catalog, stats) and writes it only if it changed."""
        prev = self.load(source.id)
        prev_jobs = {j["id"]: j for j in (prev or {}).get("jobs", [])}
        first_build = prev is None
        absorbed = absorbed_keys or set()
        jobs: list[dict[str, Any]] = []
        seen: set[str] = set()
        added = 0
        for it in items:
            if it.key in seen:
                continue
            seen.add(it.key)
            rec = _record(source, it, facets_of(it))
            old = prev_jobs.get(it.key)
            if old:
                rec["first_seen"] = old["first_seen"]
                if old.get("baseline"):
                    rec["baseline"] = True
            else:
                rec["first_seen"] = now.isoformat()
                if first_build or it.key in absorbed:
                    rec["baseline"] = True
                else:
                    added += 1
            jobs.append(rec)
        kept = 0
        if not complete:
            # Cannot prove the missing jobs are closed: keep them.
            for key, old in prev_jobs.items():
                if key not in seen:
                    jobs.append({**old, "unconfirmed": True})
                    kept += 1
        removed = 0 if not complete else sum(1 for k in prev_jobs if k not in seen)

        catalog = {
            "source_id": source.id,
            "company": source.company or source.name,
            "industry": source.industry,
            "complete": complete,
            "total_reported": total,
            "fetched": len(seen),
            "jobs": sorted(jobs, key=lambda j: (j.get("published_at") or "", j["first_seen"]), reverse=True),
        }
        comparable = lambda c: {k: v for k, v in (c or {}).items() if k != "updated_at"}  # noqa: E731
        if comparable(prev) != comparable(catalog):
            catalog["updated_at"] = now.isoformat()
            atomic_write_json(self.path(source.id), catalog, compact=True)
            changed = 1
        else:
            catalog = prev  # unchanged; keep previous updated_at
            changed = 0
        return catalog, {"added": added, "removed": removed, "kept_unconfirmed": kept, "changed": changed}

    def write_index(self, job_sources: list[Source], now: datetime) -> bool:
        """Per-company summary used by the job radar's overview. Returns True if it changed."""
        companies = []
        for src in job_sources:
            cat = self.load(src.id)
            jobs = (cat or {}).get("jobs", [])
            companies.append({
                "source_id": src.id,
                "company": src.company or src.name,
                "source_name": src.name,
                "industry": src.industry,
                "careers_url": src.careers_url or src.url,
                "channel": src.channel or src.type.value,
                "count": len(jobs),
                "complete": (cat or {}).get("complete"),
                "total_reported": (cat or {}).get("total_reported"),
                "has_catalog": cat is not None,
                # Live check status/times come from status.json, so this file only changes
                # when the catalog itself changes (no commit churn).
                "updated_at": (cat or {}).get("updated_at"),
            })
        index = {"companies": companies, "total": sum(c["count"] for c in companies)}
        path = self.dir / "index.json"
        prev = read_json(path) or {}
        if {k: v for k, v in prev.items() if k != "generated_at"} == index:
            return False
        index["generated_at"] = now.isoformat()
        atomic_write_json(path, index)
        return True


def is_complete(source: Source, fetched: int, total: int | None, capped: bool) -> bool:
    """A fetch is complete when nothing was cut off: either the API's total matches what
    we read, or (without a total) the list did not hit our own item cap."""
    if total is not None:
        return fetched >= total
    return not capped


def dump_compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))
