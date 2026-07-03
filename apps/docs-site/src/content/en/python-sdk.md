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

If you only need to call the API directly from Python, this is the shortest path.

## Suggested structure

```text
ServerSDK/sdks/oauth/python/
├─ requirements.txt
├─ .env
└─ app.py
```

## `requirements.txt`

```txt
python-dotenv==1.0.1
requests==2.32.3
```

## `.env`

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
    f"{api_base_url}/api/user/profile",
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

    if response.status_code >= 400 or payload.get("code") != 0:
        raise RuntimeError(payload.get("message", "Request failed"))

    return payload.get("data")
```

## Full shared response-unwrapping helper

If Python will call several endpoints, move the shared logic into `appserver_client.py` instead of duplicating checks in every script.

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

    if response.status_code >= 400:
        raise AppServerApiError(
            payload.get("message") or f"HTTP request failed with status {response.status_code}",
            status=response.status_code,
            code=payload.get("code"),
            payload=payload,
            request_id=request_id,
        )

    if not isinstance(payload, dict):
        raise AppServerApiError(
            "Response payload is empty",
            status=response.status_code,
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
        path="/api/user/profile",
        token=token,
    ).data
```

### `app.py`

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
    path="/api/user/balance-history",
    token=access_token,
    params={"page": 1, "pageSize": 20},
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

## Recommended follow-up reading

- `API Documentation`
- Swagger
- `OAuth Demo` if you later need third-party login

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
