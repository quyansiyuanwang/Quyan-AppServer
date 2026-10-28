# Verification

Verification generates, delivers, validates, and rate-limits one-time codes for registration, sign-in, sensitive actions, and email confirmation. Codes are stored only as hashes with purpose, expiry, remaining attempts, and consumption state. A successful verification consumes the code immediately.

## Send and verify

Sending needs the Verification send action:

```http
POST /v1/products/verification/send
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup" }
```

Verification requires a separate Verification verify action. Call `POST /v1/products/verification/verify`, adding a six-digit `code` while keeping the same `channel`, `recipient`, and `purpose`. A response with `data.valid` equal to `true` means the code was accepted and cannot be used again; `false` means verification failed, for example because the code is incorrect, expired, or already used.

Codes are valid for 10 minutes and allow up to five incorrect attempts. When a new code is sent to the same recipient for the same purpose in an instance, the previous code is invalidated, even if the channel differs.

## Channels, rate limits, and billing

Email uses platform SMTP; SMS uses an enabled provider adapter. An unavailable channel returns an explicit business error and is never reported as delivered. Limits are applied by project, recipient, source IP, and purpose. Successful send requests count toward usage, with quota and overage charges determined by the current product configuration; failed sends refund the consumed quota. Acceptance by SMTP or the SMS endpoint does not guarantee final delivery. Verification calls do not count toward product usage.
