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

## Test in the console

1. In the verification product instance’s test card, enter a product API key with the required permissions, select email or SMS, and provide a recipient and purpose.
2. Select Send verification. After receiving the message, enter the six-digit code in the same card and select Verify code.
3. Check `valid` in the test card result; in a direct API response, the field is `data.valid`. A request-success message means the API request completed; it does not by itself mean the code was valid.

Test sends are subject to the same rate limits and billing rules. Use a recipient you control and protect the API key.

## Channels, rate limits, and billing

Email uses platform SMTP; SMS uses an enabled provider adapter. An unavailable channel returns an explicit business error and is never reported as delivered. Limits are applied by project, recipient, source IP, and purpose. Successful send requests count toward usage, with quota and overage charges determined by the current product configuration; failed sends refund the consumed quota. Acceptance by SMTP or the SMS endpoint does not guarantee final delivery. Verification calls do not count toward product usage.
