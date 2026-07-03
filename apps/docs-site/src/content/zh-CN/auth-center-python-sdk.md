# 认证中心 Python SDK

适合把本平台当作统一认证中心使用的 Python 后端、自动化任务和内部服务。

相关页面：

- **切换语言栈：** [`认证中心 Node SDK`](/zh-CN/auth-center-node-sdk)
- **当前页：** `认证中心 Python SDK`
- **前端场景：** [`Browser / SPA 示例`](/zh-CN/auth-center-browser-spa-example)

## 推荐依赖

```txt
PyJWT==2.9.0
cryptography==43.0.1
python-dotenv==1.0.1
requests==2.32.3
```

## 环境变量

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## 1. 加载 JWKS

```python
import requests


def fetch_jwks(base_url: str) -> dict:
    response = requests.get(f"{base_url}/auth-center/.well-known/jwks.json", timeout=15)
    response.raise_for_status()
    return response.json()
```

## 2. 本地校验 JWT 访问令牌

```python
from __future__ import annotations

from typing import Any

import jwt
from jwt import PyJWK


def verify_access_token(
    *,
    token: str,
    jwks: dict[str, Any],
    issuer: str,
    audience: str,
) -> dict[str, Any]:
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise RuntimeError("JWT Header 缺少 kid")

    jwk_payload = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not jwk_payload:
        raise RuntimeError(f"JWKS 中找不到 kid={kid} 对应的公钥")

    signing_key = PyJWK.from_dict(jwk_payload)

    return jwt.decode(
        token,
        signing_key.key,
        algorithms=[jwk_payload.get("alg", "RS256")],
        issuer=issuer,
        audience=audience,
    )
```

## 3. 使用授权码换取令牌

```python
import requests


def exchange_authorization_code(
    *,
    base_url: str,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    code_verifier: str | None = None,
) -> dict:
    response = requests.post(
        f"{base_url}/auth-center/token",
        json={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        timeout=15,
    )
    payload = response.json()
    if response.status_code >= 400:
        raise RuntimeError(payload.get("scope") or payload.get("message") or "授权码换取令牌失败")
    return payload
```

典型返回：

```json
{
  "access_token": "jwt...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh...",
  "scope": "profile email"
}
```

## 4. 刷新访问令牌

```python
def refresh_access_token(
    *,
    base_url: str,
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> dict:
    response = requests.post(
        f"{base_url}/auth-center/token",
        json={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
        timeout=15,
    )
    payload = response.json()
    if response.status_code >= 400:
        raise RuntimeError(payload.get("scope") or payload.get("message") or "刷新令牌失败")
    return payload
```

## 5. `client_credentials` 机器到机器场景

```python
def get_machine_token(
    *,
    base_url: str,
    client_id: str,
    client_secret: str,
    scope: str | None = None,
) -> dict:
    response = requests.post(
        f"{base_url}/auth-center/token",
        json={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
        },
        timeout=15,
    )
    payload = response.json()
    if response.status_code >= 400:
        raise RuntimeError(payload.get("scope") or payload.get("message") or "获取机器令牌失败")
    return payload
```

注意：

- 会返回 `access_token`
- **不会**返回 `refresh_token`

## 6. 组合示例

```python
import os

from dotenv import load_dotenv

load_dotenv()

base_url = os.getenv("AUTH_CENTER_BASE_URL", "http://localhost:10001")
client_id = os.getenv("AUTH_CENTER_CLIENT_ID", "")
client_secret = os.getenv("AUTH_CENTER_CLIENT_SECRET", "")
issuer = os.getenv("AUTH_CENTER_ISSUER", "http://localhost:10001/auth-center")

jwks = fetch_jwks(base_url)

token_set = exchange_authorization_code(
    base_url=base_url,
    client_id=client_id,
    client_secret=client_secret,
    code="returned_authorization_code",
    redirect_uri=os.getenv("AUTH_CENTER_REDIRECT_URI", ""),
    code_verifier="pkce-verifier",
)

claims = verify_access_token(
    token=token_set["access_token"],
    jwks=jwks,
    issuer=issuer,
    audience=client_id,
)
print("verified claims =>", claims)

if token_set.get("refresh_token"):
    refreshed = refresh_access_token(
        base_url=base_url,
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=token_set["refresh_token"],
    )
    print("refreshed access token =>", refreshed["access_token"])
```

## 推荐做法

- 对 JWKS 做短时缓存，遇到未知 `kid` 再重新拉取
- 校验 `issuer`、`audience`、过期时间和需要的 scope
- 刷新令牌与客户端密钥只保存在服务端
- 怀疑泄露时立即轮换客户端密钥
- 不要编写依赖 `client_credentials` 返回刷新令牌的逻辑

## 推荐继续阅读

- `认证中心应用管理`
- `认证中心 Node SDK`
- `Browser / SPA 示例`
