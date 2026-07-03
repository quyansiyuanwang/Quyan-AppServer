# Two-Factor API Notes

This document summarizes the 2FA-related endpoints and runtime security controls.

## Endpoints

- `GET /users/me/2fa/status`
  - Read current 2FA status and trusted-device pagination capabilities.
- `POST /users/me/2fa/setup`
  - Start 2FA setup and return setup token + QR payload.
- `POST /users/me/2fa/confirm`
  - Confirm setup with TOTP code and enable 2FA.
- `POST /users/me/2fa/disable`
  - Disable 2FA using one verification method.
- `POST /users/me/2fa/recovery-codes/regenerate`
  - Regenerate recovery codes after verifying with one method.
- `PATCH /users/me/2fa/passkey-policy`
  - Configure whether passkey login also requires 2FA.
- `GET /users/me/2fa/trusted-devices?page=1&pageSize=10`
  - List trusted devices in paginated form.
- `DELETE /users/me/2fa/trusted-devices/{deviceId}`
  - Remove one trusted device.
- `POST /auth/verify-2fa`
  - Complete login with one verification method (TOTP, email code, or recovery code).
- `POST /auth/send-2fa-email-code`
  - Send an email verification code for login challenge.

## Security Behaviors

- Replay protection middleware is applied on mutation endpoints.
- 2FA challenge endpoints use dedicated rate-limit buckets:
  - verification submission (`RATE_LIMIT_2FA_*`)
  - email code sending (`RATE_LIMIT_2FA_EMAIL_SEND_*`)
- Recovery codes are stored as SHA-256 hashes.
- Recovery-code validation uses constant-time comparison.
- 2FA verification payload enforces exactly one verification method.
- Disabling 2FA revokes existing JWT sessions immediately and clears trusted-device window records.
- Login responses for users without 2FA can include a periodic setup reminder payload.

## Migration: Legacy IP/UA Trust -> Cookie Trust Token

If you are upgrading from an older trust-window strategy that relied on coarse client attributes, use the following rollout order:

1. Configure `TWO_FACTOR_TRUSTED_DEVICE_SECRET` with a high-entropy value (>= 64 chars) that is different from `JWT_ACCESS_SECRET`.
2. Configure `CORS_ALLOWED_ORIGINS` for your frontend origins when cross-origin cookies are required.
3. Deploy backend + frontend together so login requests send credentials and receive trusted-device cookies consistently.
4. Optionally force full migration by clearing Redis keys under `two_factor:trusted:*` to remove legacy trust-window records.

- Dry-run: `pnpm run trusted-device:cleanup-legacy -- --dry-run`
- Apply deletion: `pnpm run trusted-device:cleanup-legacy -- --apply`
- Custom pattern (optional): `pnpm run trusted-device:cleanup-legacy -- --pattern=two_factor:trusted:* --apply`

1. Verify migration health by checking trusted-device metrics and business audit logs for verify-hit / verify-miss trends.

## Trusted Device Endpoint Examples

### List trusted devices

Request:

```http
GET /users/me/2fa/trusted-devices?page=1&pageSize=10
Authorization: Bearer <access_token>
```

Response:

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "devices": [
      {
        "deviceId": "f8f6...",
        "ipAddress": "203.0.113.10",
        "userAgent": "Mozilla/5.0 ...",
        "fingerprint": "fp_xxx",
        "trustedAt": "2026-04-13T08:00:00.000Z",
        "lastUsedAt": "2026-04-13T09:30:00.000Z",
        "expiresInSeconds": 86300
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 10,
    "hasMore": false
  }
}
```

### Delete one trusted device

Request:

```http
DELETE /users/me/2fa/trusted-devices/{deviceId}
Authorization: Bearer <access_token>
X-Replay-Token: <replay_token>
X-Replay-Timestamp: <unix_ms>
```

Response:

```json
{
  "code": 0,
  "message": "Success",
  "data": {
    "removed": true,
    "message": "可信设备已删除"
  }
}
```

## Environment Variables

- `TWO_FACTOR_TRUST_WINDOW_MINUTES`
- `TWO_FACTOR_TRUSTED_DEVICE_SECRET`
- `TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN` (optional, for cross-subdomain cookies)
- `TWO_FACTOR_TOTP_INTERVAL_SECONDS`
- `TWO_FACTOR_TOTP_WINDOW_STEPS`
- `TWO_FACTOR_RECOVERY_CODE_COUNT`
- `TWO_FACTOR_REMINDER_ENABLED`
- `TWO_FACTOR_REMINDER_INTERVAL_DAYS`
- `RATE_LIMIT_2FA_IP_MAX`
- `RATE_LIMIT_2FA_IP_WINDOW`
- `RATE_LIMIT_2FA_CHALLENGE_MAX`
- `RATE_LIMIT_2FA_CHALLENGE_WINDOW`
- `RATE_LIMIT_2FA_EMAIL_SEND_IP_MAX`
- `RATE_LIMIT_2FA_EMAIL_SEND_IP_WINDOW`
- `RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_MAX`
- `RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_WINDOW`
- `RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_MAX`
- `RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_WINDOW`
- `RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_MAX`
- `RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_WINDOW`

### Trusted Device Secret Requirements

- `TWO_FACTOR_TRUSTED_DEVICE_SECRET` is mandatory and must not reuse JWT signing secrets.
- Minimum length is 64 characters with high-entropy random content.
- Use different values per environment (`development`, `test`, `production`) to avoid cross-environment trust.
- Rotation strategy:
  - update secret and restart service instances;
  - old trusted-device cookies naturally expire within trust window;
  - for emergency revocation, clear Redis keys matching `two_factor:trusted:*`.

  ### Trusted Device Metrics (Redis)

  Trusted-device monitoring counters are emitted to Redis in hourly buckets:
  - `metrics:two_factor:trusted_device:verify_hit:{YYYYMMDDHH}`
  - `metrics:two_factor:trusted_device:verify_miss:{YYYYMMDDHH}`
  - `metrics:two_factor:trusted_device:created:{YYYYMMDDHH}`
  - `metrics:two_factor:trusted_device:deleted:{YYYYMMDDHH}`

## Audit Logging

2FA operations are written to business logs with dedicated operation types:

- `TWO_FACTOR_SETUP_BEGIN`
- `TWO_FACTOR_SETUP_CONFIRM`
- `TWO_FACTOR_DISABLE`
- `TWO_FACTOR_RECOVERY_CODES_REGENERATE`
- `TWO_FACTOR_PASSKEY_POLICY_UPDATE`
- `TWO_FACTOR_EMAIL_CODE_SEND`
