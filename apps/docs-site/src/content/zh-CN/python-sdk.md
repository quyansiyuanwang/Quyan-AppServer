# Python SDK

适合：Python 后端、脚本工具、自动化服务、内部集成任务。

<div class="docs-jump-grid">
    <a class="docs-jump-card" href="/zh-CN/node-sdk">
        <span class="docs-jump-eyebrow">切换语言栈</span>
        <strong>Node SDK</strong>
        <span>如果你的接入是 Node.js 服务端，可以直接跳到对应模板。</span>
    </a>
    <a class="docs-jump-card current" href="/zh-CN/python-sdk">
        <span class="docs-jump-eyebrow">当前页</span>
        <strong>Python SDK</strong>
        <span>适合 Python 服务、脚本、数据任务与自动化调用场景。</span>
    </a>
    <a class="docs-jump-card" href="/zh-CN/oauth-demo">
        <span class="docs-jump-eyebrow">第三方登录</span>
        <strong>OAuth Demo</strong>
        <span>如果你需要授权码流程、回调地址或 PKCE，请继续查看完整 OAuth 示例。</span>
    </a>
</div>

## 最小使用场景

如果你只需要从 Python 服务里直接调用 API，这一页就是最短路径。

## 推荐目录

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

## 运行方式

```bash
pip install -r requirements.txt
python app.py
```

## 建议做法

- 始终设置 `timeout`
- 对 `response.status_code` 和业务层 `code` 双重判断
- 把公共请求逻辑抽成一个小函数

## 推荐封装

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

## 完整版统一响应解包工具

如果 Python 侧要接多个接口，建议整理成一个 `appserver_client.py`，不要在每个脚本里重复写校验逻辑。

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

### 这个版本解决了什么

- 统一解包 `{ code, message, data }`
- 统一抛出 HTTP / 业务错误
- 自动过滤空查询参数
- 记录 `request_id`，便于排查线上日志

## 常见问题

### 超时

- 服务端不可达
- 网络出口受限
- 下游接口耗时过长

### 解包失败

- 你以为返回是纯 JSON 数据，但实际是 `{ code, message, data }`
- 应优先读取 `data`

## 重试与幂等性建议

上面的封装函数不会自动重试——生产环境脚本建议在外层加一层轻量重试逻辑，而不是在 `call_appserver` 内部循环：

```python
import time

def call_with_retry(*, max_attempts: int = 2, backoff_seconds: float = 1.0, **kwargs) -> "AppServerResult":
    last_error: AppServerApiError | None = None
    for attempt in range(max_attempts):
        try:
            return call_appserver(**kwargs)
        except AppServerApiError as exc:
            last_error = exc
            # 仅对临时性状况重试：网络/HTTP 5xx，或 token 刚好过期（code 1006/1013）。
            # 不要对参数校验失败（1002）、资源不存在（1003）、权限不足（1004）重试——
            # 这类请求本身就是问题所在，每次结果都会一样。
            if exc.code not in (1006, 1013) and exc.status < 500:
                raise
            time.sleep(backoff_seconds * (attempt + 1))
    raise last_error  # type: ignore[misc]
```

- GET 请求天然适合重试。对于会创建或修改数据的 POST/PUT 请求，只有在确认服务端该操作是幂等的情况下才重试（例如刷新 token 后重新提交、且原始请求确认未到达服务端）——否则网络超时后的重试可能导致重复提交。
- 重试次数应控制在较少范围内（额外 1-2 次），且每次重试前都应有等待间隔，而不是立即重试。

## 推荐联动阅读

- `API Documentation`
- Swagger
- `OAuth Demo`（如果后续需要做第三方登录）

<div class="docs-jump-grid">
    <a class="docs-jump-card" href="/zh-CN/node-sdk">
        <span class="docs-jump-eyebrow">对照模板</span>
        <strong>查看 Node SDK</strong>
        <span>如果团队同时维护 Node 服务，可以用另一套模板统一封装风格。</span>
    </a>
    <a class="docs-jump-card" href="/zh-CN/oauth-demo">
        <span class="docs-jump-eyebrow">扩展场景</span>
        <strong>进入 OAuth Demo</strong>
        <span>如果需要第三方登录、回调地址与 PKCE 流程，请继续这里。</span>
    </a>
</div>
