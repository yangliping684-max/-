import httpx
import pytest

from changeradar.fetcher import FetchError, Fetcher


def make(handler, **kw):
    sleeps = []
    f = Fetcher(client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=sleeps.append,
                min_host_interval=0, **kw)
    return f, sleeps


def test_conditional_request_headers_and_304():
    seen = {}

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        seen.update(req.headers)
        return httpx.Response(304)

    f, _ = make(handler)
    res = f.fetch("https://e.com/feed", etag='"abc"', last_modified="Wed, 01 Oct 2026 00:00:00 GMT")
    assert res.not_modified
    assert seen["if-none-match"] == '"abc"'
    assert seen["if-modified-since"] == "Wed, 01 Oct 2026 00:00:00 GMT"


def test_timeouts_are_retried_then_reported():
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("slow", request=req)

    f, sleeps = make(handler, retries=3)
    with pytest.raises(FetchError, match="超时"):
        f.fetch("https://e.com/x", check_robots=False)
    assert len(calls) == 3
    assert len(sleeps) == 2  # backoff between attempts


def test_5xx_retried_and_retry_after_honoured():
    responses = iter([httpx.Response(503, headers={"retry-after": "7"}), httpx.Response(200, text="ok")])
    f, sleeps = make(lambda req: next(responses))
    assert f.fetch("https://e.com/x", check_robots=False).text == "ok"
    assert sleeps == [7.0]


def test_403_is_blocked_and_not_retried():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(403)

    f, _ = make(handler)
    with pytest.raises(FetchError) as exc:
        f.fetch("https://e.com/x", check_robots=False)
    assert exc.value.blocked and len(calls) == 1


def test_404_is_plain_error():
    f, _ = make(lambda req: httpx.Response(404))
    with pytest.raises(FetchError) as exc:
        f.fetch("https://e.com/x", check_robots=False)
    assert not exc.value.blocked and exc.value.status == 404


def test_robots_disallow_blocks_without_fetching_page():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/")
        return httpx.Response(200, text="secret")

    f, _ = make(handler)
    with pytest.raises(FetchError, match="robots.txt") as exc:
        f.fetch("https://e.com/private/page")
    assert exc.value.blocked
    assert f.fetch("https://e.com/public").text == "secret"
    assert calls == ["/robots.txt", "/public"]  # robots fetched once, private never requested


def test_robots_5xx_means_disallow():
    f, _ = make(lambda req: httpx.Response(500))
    assert f.allowed_by_robots("https://e.com/a") is False


def test_challenge_page_is_blocked():
    html = "<html><title>Just a moment</title><div id='cf-challenge'>Verify you are human</div></html>"
    f, _ = make(lambda req: httpx.Response(200, text=html, headers={"content-type": "text/html"}))
    with pytest.raises(FetchError) as exc:
        f.fetch("https://e.com/x", check_robots=False)
    assert exc.value.blocked


def test_unreachable_robots_is_transient_error_not_block():
    def handler(req):
        raise httpx.ConnectError("dns failure", request=req)

    f, _ = make(handler)
    with pytest.raises(FetchError, match="无法获取 robots.txt") as exc:
        f.fetch("https://e.com/feed")
    assert not exc.value.blocked


def test_github_rate_limit_is_not_a_block():
    f, _ = make(lambda req: httpx.Response(403, headers={"x-ratelimit-remaining": "0"}))
    with pytest.raises(FetchError, match="速率限制") as exc:
        f.fetch("https://api.github.com/repos/a/b/releases", check_robots=False)
    assert not exc.value.blocked
