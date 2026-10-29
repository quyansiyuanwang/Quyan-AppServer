# Auth Center Python SDK

Best for Python backends, automation jobs, and internal services that treat this platform as an auth center.

Related pages:

- **Switch stack:** [`Auth Center Node SDK`](/en/auth-center-node-sdk)
- **Current:** `Auth Center Python SDK`
- **Browser flow:** [`Browser / SPA Example`](/en/auth-center-browser-spa-example)

## Recommended dependencies

```txt
PyJWT==2.9.0
cryptography==43.0.1
python-dotenv==1.0.1
requests==2.32.3
```

## Environment variables

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## 1. Load JWKS

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

## 2. Verify JWT access tokens locally

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
        raise RuntimeError("JWT header missing kid")

    jwk_payload = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not jwk_payload:
        raise RuntimeError(f"Unable to find JWKS key for kid={kid}")

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

The function above verifies the signature, issuer, audience, expiry, and token use, but does not check the scopes required by your application. Before authorizing an operation using the returned claims, check that its required scopes are present.

## 3. Exchange authorization code for tokens

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
        raise RuntimeError(payload.get("scope") or payload.get("message") or "Token exchange failed")
    return payload
```

Typical result:

```json
{
  "access_token": "jwt...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh...",
  "scope": "profile email"
}
```

## 4. Refresh the access token

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
        raise RuntimeError(payload.get("scope") or payload.get("message") or "Refresh failed")
    return payload
```

## 5. Machine-to-machine with `client_credentials`

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
        raise RuntimeError(payload.get("scope") or payload.get("message") or "Machine token request failed")
    return payload
```

Important:

- this flow returns an `access_token`
- this flow does **not** return a `refresh_token`

## 6. Combined example

Put the imports and functions from sections 1–5 and the combined example in one Python file, and install the dependencies above. Move `from __future__ import annotations` from section 2 to the beginning of the file. The examples require Python 3.10 or later. Set the environment variables for your deployment and keep the `.env` file containing your client secret out of version control. The authorization code and PKCE verifier are placeholders: replace them with the code returned by a real authorization and the verifier saved for that same flow. Validate `state` in the callback before exchanging the code; this example does not implement the complete callback.

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

The JWKS response uses `{ code, message, data }`; the example reads `data.keys`. Set `AUTH_CENTER_ISSUER` to the exact configured token issuer (`iss`); do not infer it from the endpoint path.

## Recommended practices

- cache JWKS briefly and refresh on unknown `kid`
- validate `issuer`, `audience`, expiry, and required scopes
- keep refresh tokens and client secrets on the server only
- rotate secrets when compromise is suspected
- do not build logic that expects refresh tokens from `client_credentials`

## Retry guidance

Authorization codes are single-use and a successful refresh rotates the refresh token. After a network failure or timeout, do not assume the server did not process the request; if the new token cannot be recovered, start authorization again. Retry machine-token requests only in a bounded way according to the error and your application policy.

## Recommended follow-up reading

- [Manage Auth Center applications](/en/auth-center-client-management)
- [Auth Center Node SDK](/en/auth-center-node-sdk)
- [Browser SPA example](/en/auth-center-browser-spa-example)
