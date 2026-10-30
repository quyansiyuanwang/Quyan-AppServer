# Python API 调用示例

从 Python 服务、脚本或自动化任务调用曲研 API。本页使用 `requests` 和 `python-dotenv`，提供可复制的封装，无需安装平台专用 SDK。

## 使用前提

使用 Python 3.10 或更高版本及 pip。建议在项目自己的虚拟环境中运行。

本页使用已获得授权的访问凭证，不执行登录、授权码交换或刷新流程。可使用当前部署的登录访问令牌；第三方 OAuth 访问令牌还需要下列 scope。账号 AccessKey 仅能用于服务端允许的接口，不能把 Relay Token 或 OJ API Key 当作这里的访问令牌。

| 请求                                             | 用途                     | OAuth scope    | IAM 强制模式下的动作             |
| ------------------------------------------------ | ------------------------ | -------------- | -------------------------------- |
| `GET /v1/users/me`                               | 当前凭证对应的用户资料   | `profile`      | `quyan:user:GetCurrentUser`      |
| `GET /v1/balance/transactions?limit=20&offset=0` | 当前用户的第一页余额流水 | `balance:read` | `quyan:balance:ListTransactions` |

两项操作都针对当前身份的用户资源；scope 不替代资源授权，匹配的 Deny 仍可拒绝请求。先运行资料请求，确有流水授权时再启用代码中的可选请求。

## 1. 创建示例目录

```text
example/
├─ requirements.txt
├─ .env
├─ .gitignore
├─ appserver_client.py
└─ app.py
```

`requirements.txt`：

```txt
requests
python-dotenv
```

安装后按你项目的依赖管理方式锁定实际使用并验证的版本，不把示例清单当作生产锁文件。

## 2. 配置地址和凭证

在与 `app.py` 同目录的 `.env` 中替换下列占位值。地址填写当前部署的 API 源站，不附加 `/v1`；生产调用使用 HTTPS。缺少地址或凭证时直接报错，不回退到本机地址。

```env
APPSERVER_BASE_URL=https://api.example.com
ACCESS_TOKEN=replace_with_authorized_access_token
```

在 `.gitignore` 中加入：

```gitignore
.env
.venv/
__pycache__/
```

## 3. 保存请求封装

保存为 `appserver_client.py`：

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

封装要求 HTTP 2xx、JSON 对象和整数 `code: 0` 同时成立，返回包含 `data`、`request_id` 的字典；布尔值 `false` 不作为成功码。HTTP 200 的业务失败同样抛错。网络失败没有可用 HTTP 响应时，`status` 为 `None`，不会伪造状态码。

默认连接超时 5 秒、读取等待超时 15 秒。读取超时限制等待数据的间隔，并非整个调用的总时限；缓慢持续传输时总耗时可能更长。

## 4. 调用并运行

保存为 `app.py`：

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

在示例目录运行：

```bash
python -m pip install -r requirements.txt
python app.py
```

成功时输出 `Profile request succeeded`，不打印个人资料；失败时输出诊断信息并以非零状态退出。程序从脚本所在目录读取 `.env`；已有同名环境变量优先，切换部署时先检查终端环境。

## 流水分页与写操作

启用可选流水请求后，`history["records"]` 只是当前页，`history["total"]` 是匹配总数。下一页使用 `offset=20`，之后按页大小递增；第一页不代表完整历史。

封装不自动刷新凭证或重试。对只读查询增加重试时，应限定次数并退避；不要对认证或权限拒绝无限重试。添加写接口前核对权限、重放保护及二次验证要求；当前模板未实现这些交互。写入超时或断线后先核对结果，再按接口支持的幂等机制决定是否重试。

## 常见问题

| 现象或业务码               | 处理方法                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- |
| 缺少配置或 URL 格式错误    | 检查 `.env`；地址应为 API 的 HTTP(S) 源站，不带 `/v1`、路径、查询参数或用户名密码 |
| 非 JSON、3xx 或 HTML 页面  | 检查是否误填前端、文档站或需要跳转的地址；模板不自动跟随重定向                    |
| `1001`、`1014` 或 HTTP 401 | 检查凭证类型、环境、有效性及 `Authorization` 请求头                               |
| `1006`                     | 用户状态已变更，需要重新认证                                                      |
| `1013`                     | 访问令牌已过期；通过对应认证流程刷新，失败后重新认证                              |
| `1004` 或 HTTP 403         | 检查 OAuth scope、动作与资源授权、账号或角色状态以及显式 Deny                     |
| `1429` 或 HTTP 429         | 降低调用频率，按服务端限流信息等待后再决定是否重试                                |
| 超时或连接失败             | 检查网络和服务状态；没有 HTTP 状态不代表服务端未处理请求                          |

错误日志仅输出概括信息、HTTP 状态、业务码及服务端返回的请求 ID。不要把访问令牌、完整响应或个人资料粘贴到公开日志。

## 相关页面

- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)
- [API 参考]({{SWAGGER_DOCS_URL}})
- [Node.js API 调用示例]({{DOCS_BASE_URL}}/zh-CN/node-sdk)
- [OAuth 授权码示例]({{DOCS_BASE_URL}}/zh-CN/oauth-demo)
- [AccessKey 管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management)
