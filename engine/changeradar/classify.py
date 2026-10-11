"""Rule-based facet extraction for job postings and AI product updates.

Everything here only reads what the source text explicitly states. A field that cannot
be found is simply absent (the UI shows "未提供"); nothing is inferred or invented.
Each facet comes with the rule that produced it so the UI can explain it.
"""

from __future__ import annotations

import re
from collections import Counter

from .textutil import match_keywords

# --------------------------------------------------------------------------- jobs

# Ordered: the first matching rule wins (more specific first).
JOB_TYPE_RULES: list[tuple[str, str]] = [
    ("管培生", r"管培|管理培训生|management trainee|graduate (?:management )?program|junior managers? program"),
    ("暑期实习", r"暑期实习|summer intern"),
    ("日常实习", r"日常实习"),
    ("实习", r"实习|intern(?:ship)?\b|co-?op\b|working student|placement student"),
    ("校园招聘", r"校园招聘|校招|campus|秋招|春招"),
    ("应届生招聘", r"应届|new grad|graduate (?:engineer|role|position|hire)|entry[- ]level|early career|university grad"),
    # Only explicit wording: seniority words like "Manager" are not a hiring channel.
    ("社会招聘", r"社会招聘|社招|experienced (?:hire|professional)"),
]

EDUCATION_RULES: list[tuple[str, str]] = [
    ("博士", r"博士|ph\.?d|doctoral"),
    ("硕士", r"硕士|研究生|master'?s?\b|\bmsc\b|\bmba\b"),
    ("本科", r"本科|学士|bachelor'?s?\b|\bbsc\b|undergraduate"),
    ("大专", r"大专|专科|associate degree"),
]

# "2027届", "2026/2027届", "class of 2027", "2027 graduates", "graduating in 2027"
GRAD_YEAR_RE = re.compile(
    r"(20\d{2})\s*(?:[/／、-]\s*(20\d{2}))?\s*届"
    r"|class of\s*(20\d{2})"
    r"|(20\d{2})\s*(?:graduates?|grads?)\b"
    r"|graduat(?:e|ing)\s+(?:in\s+)?(?:\w+\s+)?(20\d{2})",
    re.IGNORECASE,
)

CITY_SPLIT_RE = re.compile(r"[,，;/；|、]|\s+-\s+")


def _first_rule(text: str, rules: list[tuple[str, str]]) -> str | None:
    for label, pattern in rules:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return label
    return None


def education_levels(text: str) -> list[str]:
    return [label for label, pattern in EDUCATION_RULES if re.search(pattern, text, flags=re.IGNORECASE)]


def grad_years(text: str) -> list[str]:
    years: list[str] = []
    for m in GRAD_YEAR_RE.finditer(text):
        for g in m.groups():
            if g and g not in years:
                years.append(g)
    return sorted(years)


def city_of(location: str) -> str:
    """Take the most specific leading place name from a location string."""
    parts = [p.strip() for p in CITY_SPLIT_RE.split(location or "") if p.strip()]
    return parts[0] if parts else ""


def job_facets(title: str, text: str, extra: dict[str, str], *, company: str = "", industry: str = "",
               function_groups: dict[str, list[str]] | None = None) -> dict[str, str]:
    """Facets for a job posting. Keys are omitted when the source does not state them."""
    facets: dict[str, str] = {}
    blob = f"{title}\n{text}\n" + "\n".join(extra.values())
    if extra.get("company") or company:
        facets["company"] = extra.get("company") or company
    if industry:
        facets["industry"] = industry
    if extra.get("location"):
        facets["location"] = extra["location"]
        facets["city"] = city_of(extra["location"])
    # Source-declared employment type wins over title rules.
    declared = " ".join(v for k, v in extra.items() if k in ("employment_type", "experience_level", "position_type"))
    job_type = _first_rule(f"{title}\n{declared}", JOB_TYPE_RULES)
    if job_type:
        facets["job_type"] = job_type
        facets["job_type_rule"] = "来源字段" if declared and _first_rule(declared, JOB_TYPE_RULES) == job_type else "标题文字"
    edu = education_levels(blob)
    if edu:
        facets["education"] = "、".join(edu)
    years = grad_years(blob)
    if years:
        facets["grad_year"] = "、".join(years)
    if function_groups:
        hits = match_keywords(f"{title}\n{extra.get('department', '')}\n{extra.get('function', '')}", list(function_groups),
                              groups=function_groups)
        if hits:
            facets["function"] = "、".join(hits)
    return facets


# --------------------------------------------------------------------------- AI updates

AI_TYPE_LABEL = {
    "new_model": "新模型",
    "new_feature": "新功能",
    "version": "版本更新",
    "api_change": "API 变更",
    "pricing": "定价变化",
    "status": "服务公告",
    "news": "一般新闻",
}

AI_TYPE_RULES: list[tuple[str, str]] = [
    ("pricing", r"pric(?:e|ing)|定价|价格|折扣|优惠|promo|discount|free (?:tier|trial)|\bplans?\b.*\$"),
    ("api_change", r"\bAPI\b|SDK|endpoint|deprecat|rate limit|废弃|接口"),
    ("new_model", r"(?:introducing|announcing|launch(?:ing|es)?|releas(?:e|ing))\b.*\b(?:model|GPT|Claude|Grok|Gemini|Llama|o\d)\b"
                  r"|\b(?:GPT|Claude|Grok|Gemini|Llama)[- ]?\d|发布.*模型|新模型"),
    ("new_feature", r"introducing|now available|new feature|launch|推出|上线|新功能|available in"),
]


def ai_facets(title: str, text: str, *, profile: str, vendor: str = "", is_release: bool = False) -> dict[str, str]:
    facets: dict[str, str] = {}
    if vendor:
        facets["vendor"] = vendor
    if profile == "status":
        facets["ai_type"], facets["ai_type_rule"] = "status", "来源为官方状态页"
    elif profile == "pricing":
        facets["ai_type"], facets["ai_type_rule"] = "pricing", "官方定价页中的价格发生变化"
    else:
        label = _first_rule(title, AI_TYPE_RULES) or _first_rule(text[:300], AI_TYPE_RULES[:2])
        if label:
            facets["ai_type"], facets["ai_type_rule"] = label, "标题/摘要关键词"
        elif is_release:
            facets["ai_type"], facets["ai_type_rule"] = "version", "来源为版本发布记录"
        else:
            facets["ai_type"], facets["ai_type_rule"] = "news", "未命中特定类型"
    return facets


# --------------------------------------------------------------------------- pricing

PRICE_RE = re.compile(
    r"(?:[$¥€£]|US\$|USD\s?|RMB\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:/|per)\s?[\w .]{1,24})?"
    r"|\d[\d,]*(?:\.\d+)?\s?(?:美元|元|USD)(?:\s?/\s?\S{1,8})?",
    re.IGNORECASE,
)


def price_signature(text: str) -> Counter[str]:
    """Multiset of price lines, each prefixed with the nearest preceding label line.

    "Pro" followed by "$17" becomes "pro → $17", so a price keeps its plan/model name.
    Comparing signatures (instead of raw text) means re-ordering, layout changes,
    banners or promos without a price never count as a price change.
    """
    sig: Counter[str] = Counter()
    context = ""
    for raw in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if PRICE_RE.search(line):
            # Short price-only lines get their label; long lines carry their own context.
            key = f"{context} → {line}" if context and len(line) < 40 else line
            sig[key.lower()[:240]] += 1
        elif len(line) <= 80:
            context = line
    return sig


def price_changed(old_text: str, new_text: str) -> tuple[bool, list[str], list[str]]:
    old, new = price_signature(old_text), price_signature(new_text)
    if old == new:
        return False, [], []
    added = list((new - old).elements())[:20]
    removed = list((old - new).elements())[:20]
    return True, added, removed
