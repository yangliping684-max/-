"""v0.3: reusable ATS presets (official public job-board APIs)."""

import json

import pytest

from changeradar.ats import preset
from changeradar.models import Source
from changeradar.pipeline import run

from .conftest import fixture_text, write_config

RULES = {"keyword_groups": {"物流与供应链": ["logistics"], "采购与物料管理": ["procurement"],
                            "仓储与运营": ["warehouse"], "数据分析": ["data analyst"]},
         "job_functions": ["物流与供应链", "采购与物料管理", "仓储与运营", "数据分析"]}


def test_presets_expand_to_verified_endpoints():
    s = Source(id="co-jobs", name="x", category="jobs", ats={"provider": "smartrecruiters", "id": "Continental", "country": "cn"})
    assert s.url == "https://api.smartrecruiters.com/v1/companies/Continental/postings?limit=100&country=cn"
    assert s.api.pagination and s.api.url_template == "https://jobs.smartrecruiters.com/Continental/{id}"
    assert s.profile == "jobs" and "SmartRecruiters" in s.channel
    assert preset("greenhouse", "flexport")["url"] == "https://boards-api.greenhouse.io/v1/boards/flexport/jobs"
    assert preset("lever", "lalamove")["url"] == "https://api.lever.co/v0/postings/lalamove?mode=json"
    with pytest.raises(ValueError):
        preset("workday", "x")


def test_explicit_fields_override_preset():
    s = Source(id="co-jobs", name="x", category="jobs", channel="自定义说明",
               ats={"provider": "greenhouse", "id": "flexport"})
    assert s.channel == "自定义说明"


@pytest.mark.parametrize("provider,fixture,url", [
    ("greenhouse", "greenhouse_board.json", "https://boards-api.greenhouse.io/v1/boards/exampleco/jobs"),
    ("lever", "lever_postings.json", "https://api.lever.co/v0/postings/exampleco?mode=json"),
])
def test_greenhouse_and_lever_catalogs(tmp_path, web, fetcher, now, provider, fixture, url):
    config, data = tmp_path / "config", tmp_path / "data"
    write_config(config, [{"id": "co-jobs", "name": "Example", "category": "jobs", "company": "Example Co",
                           "ats": {"provider": provider, "id": "exampleco"}}], RULES)
    web.set(url, fixture_text(fixture), content_type="application/json")
    run(config, data, fetcher=fetcher, now=now)
    cat = json.loads((data / "jobs" / "co-jobs.json").read_text())
    assert cat["complete"] is True and len(cat["jobs"]) == 2
    by_title = {j["title"]: j for j in cat["jobs"]}
    if provider == "greenhouse":
        j = by_title["Logistics Coordinator"]
        assert j["url"].endswith("/jobs/7001") and j["city"] == "Shenzhen" and j["department"] == "Operations"
        assert j["function"] == "物流与供应链" and j["published_at"].startswith("2026-10-08T06:00")
        assert by_title["Data Analyst Intern"]["job_type"] == "实习"
    else:
        j = by_title["Procurement Intern (2027 graduates)"]
        assert j["job_type"] == "实习" and j["grad_year"] == "2027" and j["function"] == "采购与物料管理"
        assert j["url"] == "https://jobs.lever.co/exampleco/c3d4" and j["published_at"].startswith("2025-10-1")
        assert by_title["Warehouse Operations Specialist"]["function"] == "仓储与运营"


def test_industry_label_does_not_make_every_job_match(tmp_path, web, fetcher, now):
    """Regression (real data): Expeditors' industry label 'Logistics' matched every posting."""
    config, data = tmp_path / "config", tmp_path / "data"
    write_config(config, [{"id": "co-jobs", "name": "Example", "category": "jobs", "company": "Example Co",
                           "keywords": ["物流与供应链"], "require_keywords": True, "baseline_items": 10,
                           "ats": {"provider": "smartrecruiters", "id": "ExampleCo", "country": "cn"}}],
                 {"keyword_groups": {"物流与供应链": ["logistics"]}, "job_functions": ["物流与供应链"]})
    url = "https://api.smartrecruiters.com/v1/companies/ExampleCo/postings?limit=100&country=cn&offset=0"
    body = {"totalFound": 2, "content": [
        {"id": "1", "name": "Software Engineer", "industry": {"label": "Logistics & Supply Chain"}, "function": {"label": "Engineering"}},
        {"id": "2", "name": "Account Manager", "industry": {"label": "Logistics & Supply Chain"}, "function": {"label": "Logistics"}}]}
    web.set(url, json.dumps(body), content_type="application/json")
    s = run(config, data, fetcher=fetcher, now=now)
    assert [e.title for e in s.new_events] == ["Account Manager"]  # matched via its *function*, not the industry


def test_trainee_program_and_new_grads_year():
    from changeradar.classify import grad_years, job_facets
    assert job_facets("Global Trainee Program 2027 (Hong Kong based)", "", {})["job_type"] == "管培生"
    f = job_facets("New Grads 2027 - Software Engineer", "", {})
    assert f["job_type"] == "应届生招聘" and f["grad_year"] == "2027"
    assert grad_years("Program 2027") == []  # a bare year is not a graduation year
