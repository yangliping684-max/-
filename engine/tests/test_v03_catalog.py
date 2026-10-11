"""v0.3: current-openings catalog, separate from change events."""

import json
from datetime import timedelta

import httpx
import pytest

from changeradar.pipeline import run

from .conftest import fixture_text, write_config

SR = "https://api.example.com/v1/companies/ExampleCo/postings?country=cn&limit=2"
JOBS = {"id": "sr-jobs", "name": "示例公司职位", "type": "api", "url": SR, "category": "jobs",
        "profile": "jobs", "company": "Example Co", "industry": "制造业", "careers_url": "https://careers.example.com",
        "channel": "SmartRecruiters 官方公开 API",
        "keywords": ["采购", "物料控制"], "require_keywords": True, "max_items": 2000, "baseline_items": 1,
        "api": {"items_path": "content", "title_field": "name",
                "url_template": "https://jobs.example.com/ExampleCo/{id}", "published_field": "releasedDate",
                "total_path": "totalFound", "pagination": {"page_size": 2, "max_pages": 5},
                "extra_fields": {"location": "location.fullLocation", "region": "location.region",
                                 "employment_type": "typeOfEmployment.label",
                                 "position_type": "customField[fieldLabel=Position type].valueLabel"}}}
RULES = {"keyword_groups": {"采购": ["purchasing"], "物料控制": ["物料计划"]}, "job_functions": ["采购", "物料控制"]}


def page(ids_titles, total, offset):
    return json.dumps({"offset": offset, "limit": 2, "totalFound": total, "content": [
        {"id": i, "name": t, "releasedDate": "2026-10-09T00:00:00Z", "location": {"fullLocation": "Suzhou, Jiangsu, China",
         "region": "Jiangsu"}, "typeOfEmployment": {"label": "Full-time"}, "customField": []} for i, t in ids_titles]})


@pytest.fixture
def setup(tmp_path, web, fetcher):
    config, data = tmp_path / "config", tmp_path / "data"
    write_config(config, [JOBS], RULES)

    def serve(pages):
        for off, body in pages.items():
            web.set(f"{SR}&offset={off}", body, content_type="application/json")
    return config, data, serve, fetcher


def cat(data):
    return json.loads((data / "jobs" / "sr-jobs.json").read_text())


def test_catalog_contains_every_open_job_not_just_baseline_events(setup, now):
    config, data, serve, fetcher = setup
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    s = run(config, data, fetcher=fetcher, now=now)
    assert len(s.new_events) == 1  # baseline_items=1: the feed stays quiet
    c = cat(data)
    assert [j["id"] for j in sorted(c["jobs"], key=lambda j: j["id"])] == ["1", "2", "3"]  # all, even non-matching
    assert c["complete"] is True and c["total_reported"] == 3
    assert all(j["baseline"] for j in c["jobs"])  # first build: nothing counts as "new"
    j3 = next(j for j in c["jobs"] if j["id"] == "3")
    assert j3["url"] == "https://jobs.example.com/ExampleCo/3" and j3["region"] == "Jiangsu" and j3["city"] == "Suzhou"
    assert j3["job_type"] == "实习" and j3["function"] == "物料控制"
    idx = json.loads((data / "jobs" / "index.json").read_text())
    assert idx["total"] == 3 and idx["companies"][0]["company"] == "Example Co"
    assert idx["companies"][0]["careers_url"] == "https://careers.example.com"


def test_new_and_closed_jobs_when_complete(setup, now):
    config, data, serve, fetcher = setup
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    run(config, data, fetcher=fetcher, now=now)
    first_seen = {j["id"]: j["first_seen"] for j in cat(data)["jobs"]}
    serve({0: page([("1", "采购工程师"), ("4", "采购专员 Purchasing")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    c = cat(data)
    ids = {j["id"]: j for j in c["jobs"]}
    assert set(ids) == {"1", "3", "4"}  # 2 closed (complete fetch)
    assert ids["1"]["first_seen"] == first_seen["1"] and ids["1"].get("baseline")
    assert not ids["4"].get("baseline") and ids["4"]["first_seen"].startswith("2026-10-11")
    kinds = sorted((e.change_type.value, e.title) for e in s.new_events)
    # "Sales" was removed but does not match the job keywords → no removal event for it
    assert kinds == [("added", "采购专员 Purchasing")]


def test_incomplete_fetch_keeps_unconfirmed_jobs(setup, now):
    config, data, serve, fetcher = setup
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    run(config, data, fetcher=fetcher, now=now)
    # The API now claims 5 jobs but the second page is gone → we cannot prove job 3 closed.
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 5, 0), 2: page([], 5, 2)})
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    c = cat(data)
    assert c["complete"] is False
    j3 = next(j for j in c["jobs"] if j["id"] == "3")
    assert j3["unconfirmed"] is True
    assert not [e for e in s.new_events if e.change_type.value == "removed"]
    st = json.loads((data / "status.json").read_text())["sources"]["sr-jobs"]
    assert "数据不完整" in st["message"]


def test_failed_fetch_never_touches_catalog(setup, web, now):
    config, data, serve, fetcher = setup
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    run(config, data, fetcher=fetcher, now=now)
    before = (data / "jobs" / "sr-jobs.json").read_text()

    def boom(req):
        raise httpx.ConnectTimeout("down", request=req)

    web.set_handler(f"{SR}&offset=0", boom)
    run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert (data / "jobs" / "sr-jobs.json").read_text() == before
    assert json.loads((data / "status.json").read_text())["sources"]["sr-jobs"]["status"] == "fetch_error"


def test_catalog_file_is_not_rewritten_when_nothing_changed(setup, now):
    config, data, serve, fetcher = setup
    serve({0: page([("1", "采购工程师"), ("2", "Sales")], 3, 0), 2: page([("3", "物料计划实习生")], 3, 2)})
    run(config, data, fetcher=fetcher, now=now)
    before = (data / "jobs" / "sr-jobs.json").read_text()
    idx_before = (data / "jobs" / "index.json").read_text()
    run(config, data, fetcher=fetcher, now=now + timedelta(hours=1))  # status: baseline → unchanged
    s = run(config, data, fetcher=fetcher, now=now + timedelta(hours=2))
    assert (data / "jobs" / "sr-jobs.json").read_text() == before
    assert (data / "jobs" / "index.json").read_text() == idx_before
    assert s.persist is False


def test_capped_list_without_total_is_incomplete(tmp_path, web, fetcher, now):
    config, data = tmp_path / "config", tmp_path / "data"
    src = {"id": "gh-jobs", "name": "g", "type": "api", "url": "https://boards.example.com/jobs", "category": "jobs",
           "profile": "jobs", "max_items": 2, "api": {"items_path": "jobs", "url_field": "absolute_url"}}
    write_config(config, [src])
    web.set(src["url"], json.dumps({"jobs": [{"id": i, "title": f"t{i}", "absolute_url": f"https://x/{i}"} for i in range(3)]}),
            content_type="application/json")
    run(config, data, fetcher=fetcher, now=now)
    c = json.loads((data / "jobs" / "gh-jobs.json").read_text())
    assert c["complete"] is False and len(c["jobs"]) == 2


def test_existing_job_source_gets_catalog_even_if_server_says_304(tmp_path, web, fetcher, now):
    """v0.2 sources already have a snapshot (+ETag); the first v0.3 run must still build a catalog."""
    config, data = tmp_path / "config", tmp_path / "data"
    src = {"id": "gh-jobs", "name": "g", "type": "api", "url": "https://boards.example.com/jobs", "category": "jobs",
           "profile": "jobs", "api": {"items_path": "jobs", "url_field": "absolute_url"}}
    write_config(config, [src])
    body = json.dumps({"jobs": [{"id": 1, "title": "t1", "absolute_url": "https://x/1"}]})
    web.set(src["url"], body, content_type="application/json", headers={"etag": '"v1"'})
    run(config, data, fetcher=fetcher, now=now)
    (data / "jobs" / "gh-jobs.json").unlink()

    def conditional(req):
        if req.headers.get("if-none-match"):
            return httpx.Response(304)
        return httpx.Response(200, text=body, headers={"content-type": "application/json"})

    web.set_handler(src["url"], conditional)
    run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert len(json.loads((data / "jobs" / "gh-jobs.json").read_text())["jobs"]) == 1


def test_time_budget_defers_sources_without_losing_data(tmp_path, web, fetcher, now):
    config, data = tmp_path / "config", tmp_path / "data"
    feeds = [{"id": f"f{i}", "name": f"f{i}", "type": "rss", "url": f"https://e{i}.example.com/f", "category": "ai"}
             for i in range(3)]
    write_config(config, feeds)
    for f in feeds:
        web.set(f["url"], fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1), budget_seconds=1e-9)
    st = json.loads((data / "status.json").read_text())["sources"]
    deferred = [k for k, v in st.items() if "顺延" in v["message"]]
    assert len(deferred) == 2 and s.run.sources_failed == 0
    assert all(st[k]["status"] == "ok" for k in deferred)  # previous state kept


def test_html_announcement_lists_are_never_complete(tmp_path, web, fetcher, now):
    config, data = tmp_path / "config", tmp_path / "data"
    src = {"id": "clg", "name": "公告", "type": "html", "url": "https://www.example.cn/", "category": "jobs",
           "profile": "jobs", "track_removals": False,
           "html": {"selector": "body", "item_selector": "a[href*='/articles/']:-soup-contains('招聘')",
                    "title_selector": ".text", "date_selector": ".time"}}
    write_config(config, [src])
    page = lambda items: "<html><body>" + "".join(
        f"<a href='/articles/{i}.shtml'><span class='time'>2026-08-2{i}</span><div class='text'>{t}</div></a>" for i, t in items) + \
        "<a href='/articles/9.shtml'><div class='text'>集团召开会议</div></a></body></html>"
    web.set(src["url"], page([(1, "华贸物流社会招聘公告"), (2, "2026届校园招聘启动")]))
    run(config, data, fetcher=fetcher, now=now)
    c = json.loads((data / "jobs" / "clg.json").read_text())
    assert c["complete"] is False and {j["title"] for j in c["jobs"]} == {"华贸物流社会招聘公告", "2026届校园招聘启动"}
    assert next(j for j in c["jobs"] if j["id"].endswith("1.shtml"))["published_at"].startswith("2026-08-21")
    web.set(src["url"], page([(3, "新的社会招聘公告")]))  # older notices scrolled off the homepage
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    c = json.loads((data / "jobs" / "clg.json").read_text())
    assert len(c["jobs"]) == 3 and sum(1 for j in c["jobs"] if j.get("unconfirmed")) == 2
    assert [e.change_type.value for e in s.new_events] == ["added"]  # no false "removed"
