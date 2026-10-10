from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from .models import RulesConfig, SourcesConfig


class ConfigError(Exception):
    pass


def _read(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigError(f"找不到配置文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{path.name} 不是有效的 JSON（第 {exc.lineno} 行，第 {exc.colno} 列）：{exc.msg}") from exc


def _format(err: ValidationError) -> str:
    lines = []
    for e in err.errors():
        loc = ".".join(str(p) for p in e["loc"])
        lines.append(f"  - {loc or '(root)'}: {e['msg']}")
    return "\n".join(lines)


def load_sources(config_dir: Path) -> SourcesConfig:
    path = Path(config_dir) / "sources.json"
    try:
        return SourcesConfig.model_validate(_read(path))
    except ValidationError as exc:
        raise ConfigError(f"sources.json 校验失败：\n{_format(exc)}") from exc


def load_rules(config_dir: Path) -> RulesConfig:
    path = Path(config_dir) / "rules.json"
    if not path.exists():
        return RulesConfig()
    try:
        return RulesConfig.model_validate(_read(path))
    except ValidationError as exc:
        raise ConfigError(f"rules.json 校验失败：\n{_format(exc)}") from exc
