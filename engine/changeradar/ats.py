"""Reusable adapters for applicant-tracking systems with *official public* job-board APIs.

A source can declare ``"ats": {"provider": "...", "id": "...", "country": "cn"}`` and the
engine fills in URL, pagination and field mapping. Every preset was verified against the
live API (see docs/SOURCES.md); identifiers are the company's public board name.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

PROVIDERS = ("smartrecruiters", "greenhouse", "lever")

CHANNEL_LABEL = {
    "smartrecruiters": "SmartRecruiters 官方公开 Posting API",
    "greenhouse": "Greenhouse 官方公开 Job Board API",
    "lever": "Lever 官方公开 Postings API",
}


def preset(provider: str, ident: str, country: str | None = None) -> dict[str, Any]:
    """Return {"type", "url", "api", "channel"} for a provider/board id."""
    i = quote(ident, safe="")
    if provider == "smartrecruiters":
        url = f"https://api.smartrecruiters.com/v1/companies/{i}/postings?limit=100"
        if country:
            url += f"&country={quote(country.lower(), safe='')}"
        api = {
            "items_path": "content", "id_field": "id", "title_field": "name",
            "url_template": f"https://jobs.smartrecruiters.com/{i}/{{id}}",
            "published_field": "releasedDate", "total_path": "totalFound",
            "pagination": {"offset_param": "offset", "page_size": 100, "max_pages": 20},
            "extra_fields": {
                "company": "company.name", "location": "location.fullLocation", "region": "location.region",
                "country": "location.country", "employment_type": "typeOfEmployment.label",
                "experience_level": "experienceLevel.label", "function": "function.label",
                "industry": "industry.label", "department": "department.label",
                "position_type": "customField[fieldLabel=Position type].valueLabel",
            },
        }
    elif provider == "greenhouse":
        url = f"https://boards-api.greenhouse.io/v1/boards/{i}/jobs"
        api = {
            "items_path": "jobs", "id_field": "id", "title_field": "title", "url_field": "absolute_url",
            "published_field": "first_published", "updated_field": "updated_at", "total_path": "meta.total",
            "extra_fields": {"location": "location.name", "department": "departments.0.name"},
        }
    elif provider == "lever":
        url = f"https://api.lever.co/v0/postings/{i}?mode=json"
        api = {
            "items_path": "", "id_field": "id", "title_field": "text", "url_field": "hostedUrl",
            "published_field": "createdAt",
            "extra_fields": {"location": "categories.location", "department": "categories.department",
                             "employment_type": "categories.commitment", "team": "categories.team"},
        }
    else:
        raise ValueError(f"不支持的招聘系统：{provider}（支持：{', '.join(PROVIDERS)}）")
    return {"type": "api", "url": url, "api": api, "channel": CHANNEL_LABEL[provider]}
