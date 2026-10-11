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
    p_probe = sub.add_parser("probe", help="调研候选信息源（robots、状态、类型、选择器）")
    p_probe.add_argument("url", nargs="?", help="候选地址")
    p_probe.add_argument("--selector", action="append", default=[], help="要测试的 CSS 选择器（可多次）")
    p_probe.add_argument("--json-path", default="", help="JSON 条目列表路径")
    p_probe.add_argument("--no-robots", action="store_true", help="官方 API：不检查 robots.txt")
    p_probe.add_argument("--file", type=Path, help="批量：JSON 数组 [{url, selectors?, json_path?, api?}]")
    p_val = sub.add_parser("validate", help="校验配置文件")
    p_val.add_argument("--config", default="config", type=Path)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    try:
        if args.cmd == "probe":
            from .probe import probe, report_json
            jobs = (json.loads(args.file.read_text(encoding="utf-8")) if args.file
                    else [{"url": args.url, "selectors": args.selector, "json_path": args.json_path, "api": args.no_robots}])
            for job in jobs:
                rep = probe(job["url"], selectors=job.get("selectors"), json_path=job.get("json_path", ""),
                            check_robots=not job.get("api", False), dump_selector=job.get("dump", ""),
                            follow_template=job.get("follow_template", ""))
                print(f"===== PROBE {job['url']}")
                print(report_json(rep))
            return 0
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
