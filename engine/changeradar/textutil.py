"""Text normalisation, hashing, keyword matching and deadline extraction."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup

# Patterns that change on every page load and must never trigger a "change".
DEFAULT_NOISE_PATTERNS: list[str] = [
    r"\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm|AM|PM)?\b",  # clock times
    r"(阅读|浏览|访问|点击)(量|次数)?\s*[:：]?\s*\d+",  # Chinese view counters
    r"\b\d[\d,]*\s+(views?|reads?|visits?)\b",
    r"(更新于|最后更新|Last updated|Updated)\s*[:：]?\s*[^\n]{0,40}",
    r"©\s*\d{4}(\s*[-–]\s*\d{4})?",
    r"(刚刚|\d+\s*(秒|分钟|小时)前|\d+\s*(seconds?|minutes?|hours?)\s+ago)",
]

TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
                   "spm", "from", "ref", "fbclid", "gclid"}


def clean_html_to_text(html: str) -> str:
    """Strip tags/scripts from an HTML fragment (e.g. feed summaries) into plain text."""
    if not html:
        return ""
    if "<" not in html:
        return normalize_whitespace(unicodedata.normalize("NFKC", html))
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "iframe", "svg", "form"]):
        tag.decompose()
    return normalize_whitespace(soup.get_text(" ", strip=True))


def normalize_whitespace(text: str) -> str:
    text = text.replace(" ", " ").replace("　", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", ln).strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def strip_noise(text: str, extra_patterns: list[str] | None = None) -> str:
    for pattern in DEFAULT_NOISE_PATTERNS + (extra_patterns or []):
        text = re.sub(pattern, "", text)
    return normalize_whitespace(text)


def content_hash(*parts: str, noise: list[str] | None = None) -> str:
    joined = "\n".join(strip_noise(unicodedata.normalize("NFKC", p or ""), noise) for p in parts)
    # Case and whitespace differences are presentation, not content.
    joined = re.sub(r"\s+", " ", joined).strip().lower()
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def short_hash(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:16]


def canonical_url(url: str) -> str:
    """Normalise a URL for cross-source de-duplication."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k.lower() not in TRACKING_PARAMS]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(sorted(query)), ""))


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def match_keywords(text: str, keywords: list[str]) -> list[str]:
    """Case-insensitive keyword matching.

    ASCII keywords match on word boundaries ("AI" must not match "said"); CJK keywords
    match as substrings because Chinese has no word delimiters.
    """
    if not keywords:
        return []
    haystack = unicodedata.normalize("NFKC", text).lower()
    hits: list[str] = []
    for kw in keywords:
        k = unicodedata.normalize("NFKC", kw).strip().lower()
        if not k:
            continue
        if k.isascii():
            if re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", haystack):
                hits.append(kw)
        elif k in haystack:
            hits.append(kw)
    return hits


# --------------------------------------------------------------------------- deadlines

_DEADLINE_CUE = (
    r"(截止日期|截止时间|报名截止|申请截止|投递截止|截至|截止|deadline|apply by|applications? close[sd]?|"
    r"due date|closing date|closes on)"
)
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

DATE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"), "ymd"),
    (re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})"), "ymd"),
    (re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})"), "mdy"),
    (re.compile(r"(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})"), "dmy"),
]


def date_from_match(m: re.Match[str], kind: str) -> date | None:
    try:
        if kind == "ymd":
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if kind == "mdy":
            month = _MONTHS.get(m.group(1)[:3].lower())
            return date(int(m.group(3)), month, int(m.group(2))) if month else None
        if kind == "dmy":
            month = _MONTHS.get(m.group(2)[:3].lower())
            return date(int(m.group(3)), month, int(m.group(1))) if month else None
    except ValueError:
        return None
    return None


def extract_deadline(text: str) -> date | None:
    """Return a deadline only when a full date (with year) follows a deadline cue word.

    Dates without a year or without an explicit cue are ignored on purpose: guessing
    would turn a publication date into a fake deadline.
    """
    if not text:
        return None
    for cue in re.finditer(_DEADLINE_CUE, text, flags=re.IGNORECASE):
        window = text[cue.end(): cue.end() + 40]
        best: tuple[int, date] | None = None
        for pattern, kind in DATE_PATTERNS:
            m = pattern.search(window)
            if m:
                d = date_from_match(m, kind)
                if d and (best is None or m.start() < best[0]):
                    best = (m.start(), d)
        if best:
            return best[1]
    return None
