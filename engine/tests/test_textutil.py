from datetime import date

from changeradar.textutil import (
    canonical_url, clean_html_to_text, content_hash, extract_deadline, match_keywords, strip_noise,
)


def test_ascii_keywords_match_on_word_boundaries():
    assert match_keywords("OpenAI said the model is ready", ["AI"]) == []
    assert match_keywords("New AI model released", ["ai"]) == ["ai"]
    assert match_keywords("Claude Code v2", ["claude code", "cursor"]) == ["claude code"]


def test_cjk_keywords_match_as_substrings():
    assert match_keywords("2027届暑期实习生招聘开启", ["实习", "校招"]) == ["实习"]


def test_fullwidth_text_is_normalised_before_matching():
    assert match_keywords("ＧＰＴ－５ 发布", ["GPT-5"]) == ["GPT-5"]


def test_empty_keywords_match_nothing():
    assert match_keywords("anything", []) == []
    assert match_keywords("anything", ["  "]) == []


def test_deadline_requires_cue_and_full_date():
    assert extract_deadline("申请截止日期：2026年10月20日") == date(2026, 10, 20)
    assert extract_deadline("Apply by Oct 31, 2026.") == date(2026, 10, 31)
    assert extract_deadline("Deadline: 5 November 2026") == date(2026, 11, 5)
    assert extract_deadline("投递截止：2026-10-30") == date(2026, 10, 30)
    # A bare publication date is not a deadline.
    assert extract_deadline("发布于 2026-10-01") is None
    # No year → refuse to guess.
    assert extract_deadline("报名截止：10月25日") is None
    # Invalid date.
    assert extract_deadline("截止日期：2026-02-30") is None


def test_noise_is_stripped_before_hashing():
    a = "政策正文\n更新于 2026-10-01 09:12\n阅读量 1532"
    b = "政策正文\n更新于 2026-10-05 18:40\n阅读量：2210"
    assert content_hash(a) == content_hash(b)
    assert content_hash("政策正文") != content_hash("政策正文（修订）")


def test_whitespace_and_case_do_not_change_hash():
    assert content_hash("Hello   World\n\n") == content_hash("hello world")


def test_custom_noise_patterns():
    assert strip_noise("Price 42 stars", [r"\d+ stars"]) == "Price"


def test_clean_html_removes_scripts():
    assert clean_html_to_text("<p>Hi <b>there</b></p><script>x()</script>") == "Hi there"


def test_canonical_url_drops_tracking_and_trailing_slash():
    assert canonical_url("HTTPS://Example.com/a/?utm_source=rss&b=2&a=1#frag") == "https://example.com/a?a=1&b=2"
