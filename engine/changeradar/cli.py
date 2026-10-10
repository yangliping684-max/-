"""Command line entry point.

    python -m changeradar run [--config config] [--data data] [--only id,id]
    python -m changeradar validate [--config config]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .config import ConfigError, load_rules, load_sources
from .pipeline import run
from .store import StoreError


def _github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            for k, v in values.items():
                fh.write(f"{k}={v}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="changeradar", description="知更 ChangeRadar 监控引擎")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="执行一次监控")
    p_run.add_argument("--config", default="config", type=Path)
    p_run.add_argument("--data", default="data", type=Path)
    p_run.add_argument("--only", default="", help="只检查这些 id（逗号分隔）")
    p_run.add_argument("--trigger", default=os.environ.get("GITHUB_EVENT_NAME", "manual"))
    p_val = sub.add_parser("validate", help="校验配置文件")
    p_val.add_argument("--config", default="config", type=Path)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    try:
        if args.cmd == "validate":
            sources = load_sources(args.config)
            load_rules(args.config)
            enabled = sum(s.enabled for s in sources.sources)
            print(f"配置有效：{len(sources.sources)} 个信息源（{enabled} 个启用），{len(sources.categories)} 个分类")
            return 0
        only = {x.strip() for x in args.only.split(",") if x.strip()} or None
        summary = run(args.config, args.data, trigger=args.trigger, only=only)
    except (ConfigError, StoreError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    r = summary.run
    print(json.dumps({
        "sources_total": r.sources_total, "sources_ok": r.sources_ok, "sources_failed": r.sources_failed,
        "sources_paused": r.sources_paused, "new_events": r.new_events, "filtered": r.filtered,
        "duplicates": r.duplicates, "persist": summary.persist, "persist_reason": summary.persist_reason,
    }, ensure_ascii=False, indent=2))
    _github_output(persist=str(summary.persist).lower(), persist_reason=summary.persist_reason,
                   new_events=str(r.new_events), sources_failed=str(r.sources_failed))
    # A run where every source failed is surfaced as a failed workflow run.
    if r.sources_total and r.sources_failed == r.sources_total - r.sources_paused and r.sources_failed > 0:
        print("所有启用的信息源均检查失败。", file=sys.stderr)
        return 1
    return 0
