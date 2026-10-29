# Python SDK

Best for Python backends, scripts, automation services, and internal integrations.

<div class="docs-jump-grid">
    <a class="docs-jump-card" href="/en/node-sdk">
        <span class="docs-jump-eyebrow">Switch stack</span>
        <strong>Node SDK</strong>
        <span>Open this version when the integration runs in a Node.js backend.</span>
    </a>
    <a class="docs-jump-card current" href="/en/python-sdk">
        <span class="docs-jump-eyebrow">Current page</span>
        <strong>Python SDK</strong>
        <span>Use this template for Python services, scripts, internal tooling, and automation flows.</span>
    </a>
    <a class="docs-jump-card" href="/en/oauth-demo">
        <span class="docs-jump-eyebrow">Third-party login</span>
        <strong>OAuth Demo</strong>
        <span>Continue there for authorization-code flow, redirect handling, and PKCE.</span>
    </a>
</div>

## Smallest use case

If you only need to call the API directly from Python, this is the shortest path. The examples use `requests` and a wrapper you can maintain; no platform-specific SDK package is required. Use Python 3.10 or later for all examples on this page.

## Suggested structure

```text
example/
├─ requirements.txt
├─ .env
└─ app.py
```

## `requirements.txt`

```txt
python-dotenv==1.0.1
requests==2.32.3
```

These examples use an authorized access token. Third-party OAuth tokens need the `profile` scope for user information and `balance:read` for balance history. Server-side resource permissions still apply. Exclude `.env` from version control.

## `.env`

Replace the example address and token with the API base URL for your deployment and an authorized access token.

```env
APPSERVER_BASE_URL=http://localhost:10001
ACCESS_TOKEN=your_access_token
```

## `app.py`

```python
import os

import requests
from dotenv import load_dotenv

load_dotenv()

api_base_url = os.getenv("APPSERVER_BASE_URL", "http://localhost:10001")
access_token = os.getenv("ACCESS_TOKEN", "")

response = requests.get(
    f"{api_base_url.rstrip('/')}/v1/users/me",
    headers={"Authorization": f"Bearer {access_token}"},
    timeout=15,
)

payload = response.json()
print(payload)
```

## Run it

```bash
pip install -r requirements.txt
python app.py
```

## Suggested practices

- Always set a `timeout`
- Check both HTTP status and business `code`
- Extract common request logic into a helper

## Suggested helper wrapper

```python
import requests


def call_api(path: str, token: str, method: str = "GET", json_body=None):
    response = requests.request(
        method,
        f"http://localhost:10001{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=json_body,
        timeout=15,
    )
    payload = response.json()

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected response format (HTTP {response.status_code})")

    if response.status_code >= 400 or payload.get("code") != 0:
        raise RuntimeError(payload.get("message", "Request failed"))

    return payload.get("data")
```

## Full shared response-unwrapping helper

If Python will call several endpoints, save the following helper as `appserver_client.py` alongside `app.py`. Replace the earlier `app.py` with the complete example below before running it.

### `appserver_client.py`

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


DEFAULT_TIMEOUT = 15


class AppServerApiError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status: int = 500,
        code: int | None = None,
        payload: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.payload = payload
        self.request_id = request_id


@dataclass(slots=True)
class AppServerResult:
    code: int
    message: str
    data: Any
    request_id: str | None
    raw: dict[str, Any]


def call_appserver(
    *,
    base_url: str,
    path: str,
    token: str | None = None,
    method: str = "GET",
    params: dict[str, Any] | None = None,
    json_body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> AppServerResult:
    request_headers = {
        "Accept": "application/json",
        **({"Authorization": f"Bearer {token}"} if token else {}),
        **({"Content-Type": "application/json"} if json_body is not None else {}),
        **(headers or {}),
    }

    response = requests.request(
        method=method,
        url=f"{base_url.rstrip('/')}{path}",
        headers=request_headers,
        params={k: v for k, v in (params or {}).items() if v not in (None, "")},
        json=json_body,
        timeout=timeout,
    )

    request_id = response.headers.get("x-request-id")

    try:
        payload = response.json()
    except ValueError as exc:
        raise AppServerApiError(
            "Response is not valid JSON",
            status=response.status_code,
            payload=response.text,
            request_id=request_id,
        ) from exc

    if not isinstance(payload, dict):
        raise AppServerApiError(
            "Response payload is not a JSON object",
            status=response.status_code,
            payload=payload,
            request_id=request_id,
        )

    if response.status_code >= 400:
        raise AppServerApiError(
            payload.get("message") or f"HTTP request failed with status {response.status_code}",
            status=response.status_code,
            code=payload.get("code"),
            payload=payload,
            request_id=request_id,
        )

    if payload.get("code") != 0:
        raise AppServerApiError(
            payload.get("message") or "Business request failed",
            status=response.status_code,
            code=payload.get("code"),
            payload=payload,
            request_id=request_id,
        )

    return AppServerResult(
        code=int(payload.get("code", 0)),
        message=str(payload.get("message", "")),
        data=payload.get("data"),
        request_id=request_id,
        raw=payload,
    )


def get_user_profile(base_url: str, token: str) -> Any:
    return call_appserver(
        base_url=base_url,
        path="/v1/users/me",
        token=token,
    ).data
```

### `app.py` (using the helper)

```python
import os

from dotenv import load_dotenv

from appserver_client import call_appserver, get_user_profile

load_dotenv()

base_url = os.getenv("APPSERVER_BASE_URL", "http://localhost:10001")
access_token = os.getenv("ACCESS_TOKEN", "")

profile = get_user_profile(base_url, access_token)
print("profile =>", profile)

history = call_appserver(
    base_url=base_url,
    path="/v1/balance/transactions",
    token=access_token,
    params={"limit": 20, "offset": 0},
)
print("balance history =>", history.data)
```

### What this version fixes

- unwraps `{ code, message, data }` consistently
- raises one shared error type for HTTP and business failures
- filters empty query params automatically
- preserves `request_id` for production troubleshooting

## Common issues

### Timeout

- backend unreachable
- network egress restricted
- upstream request too slow

### Response unpacking mistakes

- expecting raw JSON instead of `{ code, message, data }`
- reading top-level payload instead of `data`

## Retry and idempotency guidance

The helper above does not retry automatically. This example only retries GET requests after connection errors, timeouts, or HTTP 5xx responses; it does not refresh tokens:

```python
import time
import requests


def get_with_retry(*, max_attempts: int = 2, backoff_seconds: float = 1.0, **kwargs) -> "AppServerResult":
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    if kwargs.get("method", "GET").upper() != "GET":
        raise ValueError("This retry helper only supports GET requests")

    for attempt in range(max_attempts):
        try:
            return call_appserver(**kwargs)
        except AppServerApiError as exc:
            if exc.status < 500 or attempt == max_attempts - 1:
                raise
        except (requests.ConnectionError, requests.Timeout):
            if attempt == max_attempts - 1:
                raise
        time.sleep(backoff_seconds * (attempt + 1))

    raise RuntimeError("Unreachable")
```

- For `1006`, authenticate again. For `1013`, retry only after successfully refreshing credentials; authenticate again if refresh fails. When a network failure leaves a write outcome unknown, check the result or use an idempotency mechanism supported by the endpoint to avoid duplicate submissions.
- Keep retry counts small (1-2 extra attempts) and always back off between attempts instead of retrying immediately.

## Recommended follow-up reading

- [API documentation](/en/api-documentation)
- [API reference]({{SWAGGER_DOCS_URL}})
- [OAuth authorization-code example](/en/oauth-demo) for third-party login

<div class="docs-jump-grid">
    <a class="docs-jump-card" href="/en/node-sdk">
        <span class="docs-jump-eyebrow">Compare</span>
        <strong>Open Node SDK</strong>
        <span>Use the Node template too if your team maintains mixed backend stacks.</span>
    </a>
    <a class="docs-jump-card" href="/en/oauth-demo">
        <span class="docs-jump-eyebrow">Extended flow</span>
        <strong>Open OAuth Demo</strong>
        <span>Continue there for redirect handling, authorization code exchange, and PKCE.</span>
    </a>
</div>
