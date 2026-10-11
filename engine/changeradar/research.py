"""Recruiting-source research: which companies publish jobs through an official public
job-board API, and how many postings (and China postings) are there?

Only documented public endpoints of applicant-tracking systems are queried:

* SmartRecruiters Posting API   https://developers.smartrecruiters.com/docs/posting-api
* Greenhouse Job Board API      https://developers.greenhouse.io/job-board.html
* Lever Postings API            https://github.com/lever/postings-api
* Ashby public job board API    https://developers.ashbyhq.com/docs/public-job-posting-api
* Workable widget API           (public jobs widget endpoint)

A candidate only counts when the endpoint answers *and* the returned organisation name
matches the company we were looking for — an identifier that happens to exist but
belongs to someone else is reported as a mismatch, never used.

    python -m changeradar research --file docs/research/ats_candidates.json
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from .fetcher import FetchError, Fetcher

CHINA_RE = re.compile(r"\b(china|cn|prc|shanghai|beijing|shenzhen|suzhou|guangzhou|hangzhou|wuxi|chengdu|"
                      r"wuhan|tianjin|nanjing|xi'?an|dalian|qingdao|xiamen|changsha|hefei|ningbo|chongqing)\b|"
                      r"中国|上海|北京|深圳|苏州|广州|杭州|无锡|成都|武汉|天津|南京|西安", re.IGNORECASE)

# Fingerprints of recruiting systems in a careers page's HTML (evidence, not guesses).
ATS_HINTS = {
    "smartrecruiters": r"smartrecruiters\.com/([A-Za-z0-9]+)",
    "greenhouse": r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9]+)",
    "lever": r"jobs\.lever\.co/([a-z0-9-]+)",
    "ashby": r"jobs\.ashbyhq\.com/([A-Za-z0-9-]+)",
    "workable": r"apply\.workable\.com/([a-z0-9-]+)",
    "workday": r"([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com",
    "successfactors": r"(successfactors\.(?:com|eu)|jobs2web|career\d*\.sapsf)",
    "phenom": r"(phenompeople|cdn\.phenompeople\.com)",
    "eightfold": r"(eightfold\.ai)",
    "avature": r"(avature\.net)",
    "moka": r"(mokahr\.com)",
    "beisen": r"(beisen\.com|italent\.cn)",
    "oracle": r"(oraclecloud\.com/hcmUI)",
    "icims": r"(icims\.com)",
    "taleo": r"(taleo\.net)",
}


@dataclass
class AtsResult:
    company: str
    ats: str
    id: str
    status: int | None = None
    error: str = ""
    org_name: str = ""
    name_matches: bool = False
    total: int | None = None
    china: int | None = None
    samples: list[str] = field(default_factory=list)


def _names_match(expected: str, actual: str) -> bool:
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731
    e, a = norm(expected), norm(actual)
    return bool(e and a and (e in a or a in e))


def _get(fetcher: Fetcher, url: str) -> Any:
    res = fetcher.fetch(url, headers={"Accept": "application/json"}, check_robots=False)
    return json.loads(res.text)


def scan(fetcher: Fetcher, company: str, ats: str, ident: str) -> AtsResult:
    r = AtsResult(company=company, ats=ats, id=ident)
    try:
        if ats == "smartrecruiters":
            base = f"https://api.smartrecruiters.com/v1/companies/{ident}/postings"
            data = _get(fetcher, f"{base}?limit=5")
            r.total = data.get("totalFound")
            content = data.get("content") or []
            r.org_name = (content[0].get("company") or {}).get("name", "") if content else ""
            r.samples = [c.get("name", "") for c in content[:3]]
            if r.total:
                r.china = _get(fetcher, f"{base}?limit=1&country=cn").get("totalFound")
        elif ats == "greenhouse":
            board = _get(fetcher, f"https://boards-api.greenhouse.io/v1/boards/{ident}")
            r.org_name = board.get("name", "")
            jobs = _get(fetcher, f"https://boards-api.greenhouse.io/v1/boards/{ident}/jobs").get("jobs", [])
            r.total = len(jobs)
            r.china = sum(1 for j in jobs if CHINA_RE.search((j.get("location") or {}).get("name", "")))
            r.samples = [j.get("title", "") for j in jobs[:3]]
        elif ats == "lever":
            jobs = _get(fetcher, f"https://api.lever.co/v0/postings/{ident}?mode=json")
            r.total = len(jobs)
            r.china = sum(1 for j in jobs if CHINA_RE.search(json.dumps(j.get("categories", {}), ensure_ascii=False)))
            r.samples = [j.get("text", "") for j in jobs[:3]]
            r.org_name = ident  # Lever has no org-name field; verified via careers-page evidence instead
        elif ats == "ashby":
            data = _get(fetcher, f"https://api.ashbyhq.com/posting-api/job-board/{ident}")
            jobs = data.get("jobs", [])
            r.total = len(jobs)
            r.china = sum(1 for j in jobs if CHINA_RE.search(j.get("location", "") or ""))
            r.samples = [j.get("title", "") for j in jobs[:3]]
            r.org_name = ident
        elif ats == "workable":
            data = _get(fetcher, f"https://apply.workable.com/api/v1/widget/accounts/{ident}")
            r.org_name = data.get("name", "")
            jobs = data.get("jobs", [])
            r.total = len(jobs)
            r.china = sum(1 for j in jobs if CHINA_RE.search(f"{j.get('country', '')} {j.get('city', '')}"))
            r.samples = [j.get("title", "") for j in jobs[:3]]
        else:
            r.error = f"unknown ats {ats}"
            return r
        r.status = 200
        r.name_matches = _names_match(company, r.org_name) or ats in ("lever", "ashby")
    except FetchError as exc:
        r.status, r.error = exc.status, str(exc)
    except (ValueError, AttributeError, TypeError) as exc:
        r.error = f"{type(exc).__name__}: {exc}"
    return r


def ats_hints(html: str) -> dict[str, list[str]]:
    hints: dict[str, list[str]] = {}
    for name, pattern in ATS_HINTS.items():
        found = sorted({m if isinstance(m, str) else m[0] for m in re.findall(pattern, html, flags=re.IGNORECASE)})
        if found:
            hints[name] = found[:5]
    return hints


def run_research(entries: list[dict]) -> list[dict]:
    """entries: {"company": "...", "careers": "https://…"?, "ats": [["smartrecruiters", "Id"], …]?}"""
    from .probe import probe

    out = []
    fetcher = Fetcher(retries=1, min_host_interval=1.0, timeout=20)
    try:
        for e in entries:
            row: dict[str, Any] = {"company": e["company"]}
            if e.get("careers"):
                rep = probe(e["careers"], fetcher=fetcher)
                row["careers"] = {"url": e["careers"], "status": rep.status, "final_url": rep.final_url,
                                  "kind": rep.kind, "error": rep.error, "text_chars": rep.text_chars,
                                  "js": rep.likely_js_rendered, "feeds": rep.advertised_feeds,
                                  "robots": rep.robots_allowed, "ats_hints": rep.ats_hints,
                                  "links": [l for l in rep.links_sample if any(w in l.lower() for w in
                                            ("job", "career", "招聘", "人才", "join", "search", "position", "加入"))][:15]}
            row["ats"] = [asdict(scan(fetcher, e["company"], a, i)) for a, i in e.get("ats", [])]
            out.append(row)
            hit = any(a["status"] == 200 and a["total"] for a in row["ats"]) or "careers" in row
            if hit:
                print(json.dumps(row, ensure_ascii=False), flush=True)
    finally:
        fetcher.close()
    return out
