# Verification

This page handles extra verification steps used during login, security changes, or high-risk actions.

## Page purpose

- Complete two-factor verification (2FA).
- Approve step-up security checks before high-risk operations.
- Use a recovery code when the normal second factor is unavailable.
- Complete a captcha trust verification.

## What you will see

### Verification methods

- Authenticator-app TOTP code input.
- Email-code input.
- Recovery-code input when supported.
- Method switching controls.

### Captcha verification

Before registration, sending verification codes, password recovery, or password reset, the system may require a captcha challenge:

- Supports reCAPTCHA and Turnstile providers (configured by admins on the server-configuration page).
- Once verified, the system skips further captcha prompts within the configured trust window.
- Call `GET /auth/captcha/trust-status` to check whether the current session is still within the trust window.

### Rate limiting

The system applies per-IP and per-email rate limits to the following operations:

- Registration email verification code sends.
- Password-reset code sends.
- 2FA code verification (checked per IP and per challenge token).
- 2FA email code sends.

Exceeding a limit returns a `429 Too Many Requests` error with a suggested retry-after delay.

### Action area

- Submit button.
- Back or cancel button.
- Context-specific hints that explain why verification is required.

## Common actions

1. Read why the current action needs verification.
2. Select the available method you want to use.
3. Enter the requested code.
4. Submit and wait for the protected action to continue.

## Notes

- This page may appear during login, while disabling 2FA, during email changes, or during step-up security checks.
- Recovery codes should be stored offline; each code can only be used once.
- If policy consent is shown here, finish reading it before continuing.
- Replay protection is enabled on all sensitive forms — refresh the page to obtain a fresh signing session if a submission fails with a replay error.

## Related pages

- `login-register`
- `account-settings`
