# 认证中心 Python SDK

适合把本平台当作统一认证中心使用的 Python 后端、自动化任务和内部服务。

相关页面：

- **切换语言栈：** [认证中心 Node SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-node-sdk)
- **当前页：** 认证中心 Python SDK
- **前端场景：** [浏览器单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)

## 使用前准备

本页提供可复制的后端接入函数，不是已发布的软件包，也不包含完整登录回调或业务会话管理。浏览器应用应使用[单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)，不要向浏览器分发客户端密钥。

1. 在[认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)创建并启用已获审核通过的机密客户端，安全保存客户端 ID 和密钥。
2. 启用实际使用的授权类型：用户登录使用 `authorization_code`，需要刷新时同时启用 `refresh_token`；机器调用单独启用 `client_credentials`。
3. 注册精确的回调地址和所需 scope。发起授权时保存随机 `state` 和 PKCE verifier，回调先核对 `state`，再用同一次流程的授权码、回调地址和 verifier 交换令牌。这里的交换函数不能替代这些步骤。
4. 从部署管理员取得 API 基址及预期签发者。下面的 localhost 仅用于本地开发；生产使用部署提供的 HTTPS 地址。`AUTH_CENTER_BASE_URL` 是 API 根地址，不要额外包含 `/v1` 或 `/auth-center`；`AUTH_CENTER_ISSUER` 则是独立配置，必须与预期的 `iss` 完全一致。

令牌端点的成功响应是直接的令牌对象，JWKS 成功响应是 `{ code, message, data }`。请勿混用解析方式。`expires_in`、scope 和是否返回刷新令牌取决于当前客户端配置，后文 JSON 中的 `3600` 是示例值。只有启用了刷新授权的用户授权码流程才返回刷新令牌。

## 安装依赖

示例需要 Python 3.10 或更高版本。使用虚拟环境安装依赖，避免与其他项目混用：

```bash
python -m venv .venv
```

激活该环境后执行：

```bash
python -m pip install "PyJWT[crypto]" python-dotenv requests
```

Windows PowerShell 可用 `.venv\Scripts\Activate.ps1`，macOS/Linux 可用 `source .venv/bin/activate` 激活。安装后按应用流程锁定和维护依赖；这里没有单独的认证中心 PyPI SDK。

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
    response = requests.get(f"{base_url.rstrip('/')}/v1/auth-center/.well-known/jwks.json", timeout=15)
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 0 or not isinstance(payload.get("data", {}).get("keys"), list):
        raise RuntimeError("Invalid JWKS response")
    return payload["data"]
```

## 2. 本地校验 JWT 访问令牌

```python
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
    if not isinstance(issuer, str) or not issuer.strip() or not isinstance(audience, str) or not audience.strip():
        raise ValueError("Expected issuer and audience are required")

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str) or not kid:
        raise RuntimeError("JWT 算法不是 RS256 或缺少有效 kid")

    jwk_payload = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not jwk_payload:
        raise RuntimeError(f"JWKS 中找不到 kid={kid} 对应的公钥")

    if (jwk_payload.get("kty"), jwk_payload.get("alg"), jwk_payload.get("use")) != ("RSA", "RS256", "sig"):
        raise RuntimeError("Unexpected signing key")
    signing_key = PyJWK.from_dict(jwk_payload)

    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=issuer,
        audience=audience,
        options={"require": ["exp", "iss", "aud"]},
    )
    if claims.get("token_use") != "access_token":
        raise RuntimeError("Invalid access token claims")
    return claims
```

上面的函数验证签名、签发者、受众、过期时间和令牌用途，但不会检查业务所需的 scope。请在使用返回的 claims 授权操作之前，单独检查 scope 是否包含该操作要求的值。

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
        f"{base_url.rstrip('/')}/v1/auth-center/token",
        json={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            **({"code_verifier": code_verifier} if code_verifier else {}),
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
        f"{base_url.rstrip('/')}/v1/auth-center/token",
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
        f"{base_url.rstrip('/')}/v1/auth-center/token",
        json={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            **({"scope": scope} if scope else {}),
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

将第 1–5 节的导入和函数与下面的组合示例放在同一 Python 文件中，并安装上述依赖。示例需要 Python 3.10 或更高版本。填写本部署的环境变量；不要提交包含客户端密钥的 `.env`。示例中的授权码和 PKCE verifier 是占位符，必须替换为同一次真实授权返回的授权码和发起时保存的 verifier。交换前还需在回调中校验 `state`；此处未实现完整的授权回调。

```python
import os

from dotenv import load_dotenv

load_dotenv()

base_url = os.environ["AUTH_CENTER_BASE_URL"]
client_id = os.environ["AUTH_CENTER_CLIENT_ID"]
client_secret = os.environ["AUTH_CENTER_CLIENT_SECRET"]
issuer = os.environ["AUTH_CENTER_ISSUER"]

jwks = fetch_jwks(base_url)

token_set = exchange_authorization_code(
    base_url=base_url,
    client_id=client_id,
    client_secret=client_secret,
    code="returned_authorization_code",
    redirect_uri=os.environ["AUTH_CENTER_REDIRECT_URI"],
    code_verifier="saved_verifier_from_this_authorization_flow",
)

claims = verify_access_token(
    token=token_set["access_token"],
    jwks=jwks,
    issuer=issuer,
    audience=client_id,
)
print("Token verified")

if token_set.get("refresh_token"):
    refreshed = refresh_access_token(
        base_url=base_url,
        client_id=client_id,
        client_secret=client_secret,
        refresh_token=token_set["refresh_token"],
    )
    # Persist refreshed["refresh_token"] securely; the previous refresh token has been rotated.
```

请求 JWKS 返回 `{ code, message, data }`，示例取出 `data.keys`。令牌签发者以部署配置为准；`AUTH_CENTER_ISSUER` 必须与令牌中的 `iss` 完全一致，不要从接口路径推断。

## 校验边界与令牌更新

本地 JWT 校验只证明签名和所检查的声明有效，不会实时查询客户端是否停用、用户是否失效、授权是否撤销或令牌记录是否被撤销。应用需要自行确定实时状态检查和本地会话失效策略；不能把“验签通过”等同于当前仍获准访问。只从预先配置的可信部署读取 JWKS，不要根据未验证令牌中的 URL 自动下载密钥。

验证后的 `scope` 是空格分隔的字符串，应按完整 scope 名称检查，不能用子字符串包含判断。`aud` 期望值是当前客户端 ID。用户令牌的 `sub` 表示用户，机器令牌的 `sub` 表示客户端 ID，机器令牌没有用户 `uid`；机器令牌不能作为用户登录凭据。本页不处理 ID Token，也不承诺认证中心令牌可直接调用任意平台 API。

成功刷新会替换刷新令牌；请按客户端会话串行刷新，安全保存返回的新令牌，后续不再使用旧值。刷新后的 scope 按当前授权和客户端配置重新计算，应用应重新检查所需 scope。刷新本身不会自动撤销之前签发的访问令牌。示例的注释仅提示保存位置，未实现持久化。

JWKS 示例每次调用都请求公钥，没有实现缓存或自动轮换恢复。生产接入可使用有期限的缓存；遇到未知 `kid` 时，从相同可信地址有限刷新后重试校验，仍未知则拒绝。开发环境使用临时签名密钥时，后端重启会更换密钥，旧令牌可能不再通过校验。

## 常见失败与恢复

| 现象                           | 检查与处理                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 客户端认证失败或应用不可用     | 核对 ID、最新密钥、机密客户端类型、审核及启用状态；机器流程还须启用对应授权类型。                           |
| 授权码或刷新令牌无效           | 检查过期、重复使用、客户端归属、精确回调地址和 PKCE verifier；无法恢复时重新授权。                          |
| scope 无效或不足               | 只申请客户端已配置的 scope，检查返回值并按操作授权；省略 scope 会采用客户端配置的范围。                     |
| 未知 `kid`、签发者或受众不匹配 | 核对可信 JWKS 地址、部署签发者、客户端 ID 和密钥轮换；不要关闭校验来解决。                                  |
| 超时、非 JSON 响应或网络错误   | 检查 API 基址、反向代理和网络。示例会抛出异常，调用方须转换为应用自己的失败响应，不要把令牌或密钥写入日志。 |

授权码和刷新请求不做自动重试。超时或网络中断不能证明服务端未处理；返回的新令牌无法恢复时应重新授权。机器令牌请求也应按错误类型有限重试，避免无界循环。

## 推荐继续阅读

- [认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)
- [认证中心 Node SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-node-sdk)
- [浏览器单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)
