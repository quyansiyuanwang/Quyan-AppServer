# Verification

Verification generates, delivers, validates, and rate-limits one-time codes for registration, sign-in, sensitive actions, and email confirmation. Codes are stored only as hashes with purpose, expiry, remaining attempts, and consumption state. A successful verification consumes the code immediately.

## Send and verify

Sending needs the Verification send action:

```http
POST /v1/products/verification/send
Authorization: Bearer dpk_...
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup" }
```

Verify through `POST /v1/products/verification/verify`, adding a six-digit `code` while keeping the same `channel`, `recipient`, and `purpose`. A `{ "valid": true }` response means the code cannot be used again.

## Channels, rate limits, and billing

Email uses platform SMTP; SMS uses an enabled provider adapter. An unavailable channel returns an explicit business error and is never reported as delivered. Limits are applied by project, recipient, source IP, and purpose. Only messages successfully delivered consume quota or incur overage billing; failed verification is not billed.
