# Python API example

Call Quyan APIs from Python services, scripts, or automation with a copyable wrapper using `requests` and `python-dotenv`. No platform-specific SDK package is required.

## Prerequisites

Use Python 3.10 or later with pip, preferably in a virtual environment for this project.

This example starts with an authorized credential; it does not log in, exchange authorization codes, or refresh tokens. Use a login access token for this deployment, or a third-party OAuth access token with the scopes below. Account AccessKeys work only where the service permits them. Relay Tokens and OJ API Keys are separate credentials.

| Request                                          | Purpose                                               | OAuth scope    | Action under IAM enforcement     |
| ------------------------------------------------ | ----------------------------------------------------- | -------------- | -------------------------------- |
| `GET /v1/users/me`                               | Profile of the current credential's user              | `profile`      | `quyan:user:GetCurrentUser`      |
| `GET /v1/balance/transactions?limit=20&offset=0` | First page of the current user's balance transactions | `balance:read` | `quyan:balance:ListTransactions` |

Both operations target the current identity's user resource. Scopes do not replace resource authorization, and a matching Deny can reject the request. Run the profile request first; enable the optional transaction request only when authorized.

## 1. Create the example directory

```text
example/
├─ requirements.txt
├─ .env
├─ .gitignore
├─ appserver_client.py
└─ app.py
```

`requirements.txt`:

```txt
requests
python-dotenv
```

After installation, lock the versions you actually use and verify through your project dependency workflow. This example list is not a production lockfile.

## 2. Configure the address and credential

Replace both placeholders in `.env` alongside `app.py`. Use the deployment API origin without `/v1`, and use HTTPS in production. A missing address or credential fails without falling back to localhost.

```env
APPSERVER_BASE_URL=https://api.example.com
ACCESS_TOKEN=replace_with_authorized_access_token
```

Add to `.gitignore`:

```gitignore
.env
.venv/
__pycache__/
```

## 3. Save the request wrapper

Save as `appserver_client.py`:

```python
from typing import Any
from urllib.parse import urljoin, urlsplit

import requests

DEFAULT_TIMEOUT = (5, 15)


class AppServerApiError(RuntimeError):
    def __init__(self, message, *, status=None, code=None, request_id=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id


def call_appserver(
    *, base_url: str, token: str, path: str,
    params: dict[str, Any] | None = None,
    method: str = "GET", json_body: Any = None,
    timeout=DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    if not base_url or not base_url.strip() or not token or not token.strip():
        raise ValueError("Set APPSERVER_BASE_URL and ACCESS_TOKEN")
    base = urlsplit(base_url)
    if (
        base.scheme not in ("http", "https") or not base.hostname
        or base.username is not None or base.password is not None
        or base.path not in ("", "/") or base.query or base.fragment
    ):
        raise ValueError("APPSERVER_BASE_URL must be an HTTP(S) origin")
    if not path.startswith("/v1/") or "\\" in path:
        raise ValueError("Use an API path beginning with /v1/")
    url = urljoin(base_url, path)
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token.strip()}",
    }
    try:
        response = requests.request(
            method, url, headers=headers,
            params={k: v for k, v in (params or {}).items() if v is not None},
            json=json_body, timeout=timeout, allow_redirects=False,
        )
    except requests.Timeout:
        raise AppServerApiError("Request timed out") from None
    except requests.RequestException:
        raise AppServerApiError("Request could not complete") from None

    with response:
        status = response.status_code
        request_id = response.headers.get("x-request-id")
        try:
            payload = response.json()
        except ValueError:
            raise AppServerApiError(
                "Response is not valid JSON", status=status, request_id=request_id,
            ) from None
        is_envelope = isinstance(payload, dict) and type(payload.get("code")) is int
        code = payload["code"] if is_envelope else None
        if not 200 <= status < 300 or not is_envelope or code != 0:
            raise AppServerApiError(
                "API request failed", status=status, code=code, request_id=request_id,
            )
        return {"data": payload.get("data"), "request_id": request_id}
```

Success requires HTTP 2xx, a JSON object, and integer `code: 0`. The returned dictionary contains `data` and `request_id`; boolean `false` is not a success code. Business failures throw even with HTTP 200. Network failures without an HTTP response have `status=None`, without a fabricated status.

Defaults are a five-second connection timeout and a 15-second read timeout. Read timeout limits waiting between received data rather than total call duration; a slow continuous response can take longer.

## 4. Call and run

Save as `app.py`:

```python
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from appserver_client import AppServerApiError, call_appserver

load_dotenv(Path(__file__).with_name(".env"))

try:
    options = {
        "base_url": os.getenv("APPSERVER_BASE_URL", ""),
        "token": os.getenv("ACCESS_TOKEN", ""),
    }
    profile = call_appserver(**options, path="/v1/users/me")["data"]
    if not isinstance(profile, dict) or not isinstance(profile.get("id"), str):
        raise ValueError("Unexpected profile data")
    print("Profile request succeeded")

    # Optional: requires balance:read for an OAuth token.
    # history = call_appserver(
    #     **options, path="/v1/balance/transactions",
    #     params={"limit": 20, "offset": 0},
    # )["data"]
    # print("Records on this page:", len(history["records"]))
except (AppServerApiError, ValueError) as error:
    print(str(error), file=sys.stderr)
    if isinstance(error, AppServerApiError):
        print({
            "status": error.status,
            "code": error.code,
            "request_id": error.request_id,
        }, file=sys.stderr)
    sys.exit(1)
```

Run from the example directory:

```bash
python -m pip install -r requirements.txt
python app.py
```

Success prints `Profile request succeeded` without personal information; failure prints diagnostics and exits with a nonzero status. The script reads `.env` from its own directory. Existing environment variables take priority; check the shell environment when changing deployments.

## Transaction pagination and writes

`history["records"]` from the optional transaction request is only the current page; `history["total"]` is the matching total. Use `offset=20` for the next page and increment by page size. The first page is not complete history.

The wrapper does not refresh credentials or retry. If adding retries for read-only queries, bound attempts and back off; do not repeatedly retry authentication or permission refusals. Before adding writes, check permission, replay-protection, and two-factor requirements; these interactions are not implemented here. After a write timeout or disconnect, check the outcome before retrying through an idempotency mechanism supported by the endpoint.

## Troubleshooting

| Symptom or business code             | What to check                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Missing configuration or invalid URL | Check `.env`; use the API HTTP(S) origin without `/v1`, a path, query, or embedded credentials               |
| Non-JSON, 3xx, or HTML               | Check for a frontend, documentation, or redirecting address; the template does not follow redirects          |
| `1001`, `1014`, or HTTP 401          | Check credential type, environment, validity, and the `Authorization` header                                 |
| `1006`                               | User state changed; authenticate again                                                                       |
| `1013`                               | Refresh the expired token through its own authentication flow; authenticate again if refresh fails           |
| `1004` or HTTP 403                   | Check OAuth scopes, action/resource grants, account or role state, and explicit Deny                         |
| `1429` or HTTP 429                   | Reduce request frequency and use server rate-limit information before deciding to retry                      |
| Timeout or connection failure        | Check the network and service; no HTTP status does not establish that the server did not process the request |

Error output contains a general message, HTTP status, business code, and request ID when supplied by the server. Do not paste credentials, full responses, or personal information into public logs.

## Related pages

- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
- [API reference]({{SWAGGER_DOCS_URL}})
- [Node.js API example]({{DOCS_BASE_URL}}/en/node-sdk)
- [OAuth authorization-code example]({{DOCS_BASE_URL}}/en/oauth-demo)
- [AccessKey management]({{DOCS_BASE_URL}}/en/access-key-management)
