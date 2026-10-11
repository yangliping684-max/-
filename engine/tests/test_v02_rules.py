"""v0.2: synonym groups, keyword combos, job facets, AI types, price signatures."""

from changeradar.classify import ai_facets, grad_years, job_facets, price_changed, price_signature
from changeradar.textutil import match_keywords

GROUPS = {"供应链": ["supply chain", "SCM"], "采购": ["procurement", "purchasing"], "实习": ["intern", "internship"]}


def test_synonym_group_matches_any_language():
    assert match_keywords("Supply Chain Analyst", ["供应链"], GROUPS) == ["供应链"]
    assert match_keywords("供应链计划专员", ["供应链"], GROUPS) == ["供应链"]
    assert match_keywords("Sales Manager", ["供应链"], GROUPS) == []


def test_keyword_combination_requires_every_part():
    assert match_keywords("Procurement Intern", ["实习 & 采购"], GROUPS) == ["实习 & 采购"]
    assert match_keywords("Procurement Manager", ["实习 & 采购"], GROUPS) == []


def test_groups_are_optional_and_backward_compatible():
    assert match_keywords("OpenAI said", ["AI"]) == []
    assert match_keywords("New AI model", ["AI"]) == ["AI"]


def test_job_facets_only_contain_stated_information():
    f = job_facets("物料计划实习生（2027届，本科及以上）", "", {"location": "Wuxi, Jiangsu, China"},
                   company="Example", industry="制造业", function_groups={"物料控制": ["物料计划", "MC"]})
    assert f["job_type"] == "实习" and f["job_type_rule"] == "标题文字"
    assert f["grad_year"] == "2027" and f["education"] == "本科"
    assert f["city"] == "Wuxi" and f["company"] == "Example" and f["function"] == "物料控制"
    bare = job_facets("Software Engineer", "", {})
    assert "job_type" not in bare and "education" not in bare and "grad_year" not in bare


def test_job_type_prefers_source_declared_field_and_does_not_guess_from_seniority():
    f = job_facets("Purchasing Specialist", "", {"position_type": "Junior Managers Program"})
    assert f["job_type"] == "管培生" and f["job_type_rule"] == "来源字段"
    assert "job_type" not in job_facets("Supply Chain Manager", "", {})


def test_grad_year_patterns():
    assert grad_years("面向2026/2027届毕业生") == ["2026", "2027"]
    assert grad_years("Class of 2028 and 2028 graduates") == ["2028"]
    assert grad_years("成立于2015年") == []


def test_ai_types():
    assert ai_facets("Introducing Claude Haiku 5.5", "", profile="ai")["ai_type"] == "new_model"
    assert ai_facets("New pricing for teams", "", profile="ai")["ai_type"] == "pricing"
    assert ai_facets("Deprecating the v1 endpoint", "", profile="ai")["ai_type"] == "api_change"
    assert ai_facets("v2.1.0", "Bug fixes", profile="ai", is_release=True)["ai_type"] == "version"
    assert ai_facets("Barclays scales Claude", "", profile="ai")["ai_type"] == "news"
    assert ai_facets("Elevated errors", "", profile="status")["ai_type"] == "status"


def test_price_signature_keeps_labels_and_ignores_order():
    a = "Pro\n$20\nper month\nTeam\n$30"
    b = "Team\n$30\nBanner text\nPro\n$20\nper month"
    assert price_signature(a) == price_signature(b)
    assert "pro → $20" in price_signature(a)
    changed, added, removed = price_changed(a, a.replace("$20", "$25"))
    assert changed and added == ["pro → $25"] and removed == ["pro → $20"]
    assert price_changed("Hello world", "Hello there") == (False, [], [])
