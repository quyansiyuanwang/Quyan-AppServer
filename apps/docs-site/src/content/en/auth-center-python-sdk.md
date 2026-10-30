# Auth Center Python SDK

Best for Python backends, automation jobs, and internal services that treat this platform as an auth center.

Related pages:

- **Switch stack:** [Auth Center Node SDK]({{DOCS_BASE_URL}}/en/auth-center-node-sdk)
- **Current:** Auth Center Python SDK
- **Browser flow:** [Browser SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example)

## Before you begin

This page provides backend functions to copy, not a published package or a complete login callback and application-session implementation. Use the [SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example) for browser applications; never ship a client secret to a browser.

1. Create an enabled, approved confidential client in [Auth Center application management]({{DOCS_BASE_URL}}/en/auth-center-client-management), and store its ID and secret securely.
2. Enable the grants you use: `authorization_code` for user login, plus `refresh_token` if refreshing is required. Enable `client_credentials` separately for machine calls.
3. Register the exact callback address and required scopes. Save a random `state` and PKCE verifier when starting authorization. Check `state` at the callback before exchanging the code with the matching redirect URI and verifier. The exchange function does not replace these steps.
4. Obtain the API base URL and expected issuer from the deployment administrator. The localhost values below are for local development; use the deployment's HTTPS address in production. `AUTH_CENTER_BASE_URL` is the API root, without an additional `/v1` or `/auth-center` suffix. `AUTH_CENTER_ISSUER` is configured independently and must exactly match the expected `iss`.

The token endpoint returns the token object directly on success; JWKS success uses `{ code, message, data }`. Keep their parsing separate. `expires_in`, scopes, and refresh-token availability depend on current client settings; `3600` in the JSON example is illustrative. Only a user authorization-code flow with the refresh grant enabled returns a refresh token.

## Install dependencies

The examples require Python 3.10 or later. Create a virtual environment to isolate these dependencies:

```bash
python -m venv .venv
```

Activate it, then run:

```bash
python -m pip install "PyJWT[crypto]" python-dotenv requests
```

Activate with `.venv\Scripts\Activate.ps1` in Windows PowerShell or `source .venv/bin/activate` on macOS/Linux. Lock and maintain dependencies through your application workflow; there is no separate Auth Center PyPI SDK here.

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
        raise RuntimeError("Expected RS256 JWT with a valid kid")

    jwk_payload = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not jwk_payload:
        raise RuntimeError(f"Unable to find JWKS key for kid={kid}")

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

Put the imports and functions from sections 1–5 and the combined example in one Python file, and install the dependencies above. The examples require Python 3.10 or later. Set the environment variables for your deployment and keep the `.env` file containing your client secret out of version control. The authorization code and PKCE verifier are placeholders: replace them with the code returned by a real authorization and the verifier saved for that same flow. Validate `state` in the callback before exchanging the code; this example does not implement the complete callback.

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

The JWKS response uses `{ code, message, data }`; the example reads `data.keys`. Set `AUTH_CENTER_ISSUER` to the exact configured token issuer (`iss`); do not infer it from the endpoint path.

## Verification limits and token updates

Local JWT verification establishes the signature and checked claims. It does not query whether the client is disabled, the user is unavailable, consent is withdrawn, or the stored token has been revoked. Define your own current-state checks and local-session invalidation policy; a valid signature does not establish current access authority. Fetch JWKS only from a trusted, preconfigured deployment, never from a URL supplied by an unverified token.

The verified `scope` claim is a space-delimited string. Match complete scope names, not substrings. The expected `aud` is your client ID. A user token's `sub` identifies the user; a machine token's `sub` identifies the client and has no user `uid`. A machine token is not a user login credential. This page does not handle ID Tokens or promise that Auth Center tokens can call arbitrary platform APIs.

A successful refresh replaces the refresh token. Serialize refreshes for a client session, store the returned token securely, and stop using the previous value. Returned scopes are recalculated from current consent and client configuration; check required scopes again. Refreshing does not automatically revoke previously issued access tokens. The example comment identifies where storage is needed but does not implement persistence.

The JWKS function fetches keys on every call and implements neither caching nor automatic rotation recovery. Production integrations can use an expiring cache. On an unknown `kid`, refresh from the same trusted address with bounded retries, then reject if the key remains unknown. Development backends using ephemeral signing keys change keys on restart, which can invalidate verification of old tokens.

## Common failures and recovery

| Symptom                                                  | Check and recovery                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client authentication failure or unavailable application | Check ID, current secret, confidential client type, approval, and enabled state. Machine calls also require their grant to be enabled.                      |
| Invalid authorization code or refresh token              | Check expiry, reuse, client binding, exact redirect URI, and PKCE verifier; authorize again if recovery is impossible.                                      |
| Invalid or insufficient scope                            | Request only configured scopes, inspect the response, and authorize each operation. Omitting scope uses the client's configured scopes.                     |
| Unknown `kid` or issuer/audience mismatch                | Check the trusted JWKS address, configured issuer, client ID, and key rotation. Do not disable verification.                                                |
| Timeout, non-JSON response, or network failure           | Check API root, proxy, and connectivity. The examples raise exceptions; map them to your application's failure responses without logging tokens or secrets. |

Code-exchange and refresh functions do not retry automatically. A timeout or disconnect does not prove that the server did not process the request. Authorize again if the new tokens cannot be recovered. Bound machine-token retries according to the error instead of retrying indefinitely.

## Recommended follow-up reading

- [Manage Auth Center applications]({{DOCS_BASE_URL}}/en/auth-center-client-management)
- [Auth Center Node SDK]({{DOCS_BASE_URL}}/en/auth-center-node-sdk)
- [Browser SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example)
