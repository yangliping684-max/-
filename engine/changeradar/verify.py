"""Dry-run report used during source research: run the real pipeline on a *copy* of the
data directory and print per-source status plus sample events. Never touches data/."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path

from .pipeline import run


def main(config: Path, data: Path, only: set[str] | None = None) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "data"
        if data.exists():
            shutil.copytree(data, work)
        summary = run(config, work, trigger="verify", only=only)
        status = json.loads((work / "status.json").read_text())
        by_source: dict[str, list] = {}
        for e in summary.new_events:
            by_source.setdefault(e.source_id, []).append(e)
        for sid, st in status["sources"].items():
            if only and sid not in only:
                continue
            evs = by_source.get(sid, [])
            print(f"\n## {sid}: {st['status']} · items={st['item_count']} · http={st['http_status']}")
            print(f"   {st['message']}")
            print(f"   events: {len(evs)} {dict(Counter(e.change_type.value for e in evs))}")
            for e in evs[:4]:
                print(f"   - [{e.change_type.value} {e.score}] {e.title[:70]} | pub={e.published_at} | {e.url[:90]}")
                if e.facets:
                    print(f"     facets={json.dumps(e.facets, ensure_ascii=False)}")
                if e.matched_keywords:
                    print(f"     keywords={e.matched_keywords}")
        backfilled = [e for e in json.loads((work / "events.json").read_text())["events"]
                      if e.get("facets") and e["change_type"] == "initial" and e["source_id"] in ("anthropic-jobs",)]
        print(f"\nbackfilled anthropic-jobs events with facets: {len(backfilled)}")
        for e in backfilled[:3]:
            print("  ", e["title"][:60], json.dumps(e["facets"], ensure_ascii=False))
        print("\nRUN:", summary.run.model_dump_json())
    return 0


if __name__ == "__main__":
    ids = set(sys.argv[1].split(",")) if len(sys.argv) > 1 and sys.argv[1] else None
    raise SystemExit(main(Path("config"), Path("data"), ids))
