# Verification

When login, registration, security changes, or high-risk actions require 2FA, a full-screen verification overlay appears over the current page, preserving unsaved edits. The standalone `/auth/verify` screen remains available for direct access. Captcha uses its separate `/auth/captcha` page.

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

- The standalone verification page uses Turnstile. Follow the on-screen instructions to complete the challenge.
- After verification, the system may skip repeated captcha challenges within the configured trust window.

### Rate limiting

The system rate-limits the following operations. The dimensions and wait times depend on the operation and server configuration:

- Registration email verification code sends.
- Password-reset code sends.
- 2FA code verification (checked per IP and per challenge token).
- 2FA email code sends.

If you reach a limit, wait as directed on the page before trying again.

### Action area

- Submit button.
- The standalone verification page provides a back button; the full-screen overlay cannot be dismissed with the backdrop, Escape, or a back button.
- Context-specific hints that explain why verification is required.

## Common actions

1. Read why the current action needs verification.
2. Select the available method you want to use.
3. Enter the requested code.
4. Submit and wait for the protected action to continue.

### Choose a code method

- For an authenticator app, enter its six-digit code. If the app is unavailable, select **Use a recovery code instead** under that method and enter a saved recovery code; each recovery code can be used once.
- For email verification, switch to the email method, select **Send email code**, and submit the six-digit code you receive. After a successful send, the button has a 60-second cooldown; sending may first require a captcha.
- The verification screen for disabling 2FA accepts an authenticator code or recovery code and does not offer the email method.

## Notes

- The overlay can appear during login, registration, disabling 2FA, email changes, or step-up security checks. After step-up verification, pending requests resume on the same page without remounting it.
- After a refresh, the overlay reappears if a verification challenge is still pending; unsaved page data and pending original requests do not survive the refresh. Restart the original action after verification or if the challenge has expired.
- Recovery codes should be stored offline; each code can only be used once.
- If policy consent is shown here, finish reading it before continuing.
- If verification fails, check the code and your device clock. If the challenge expires, restart the original action.

## Related pages

- [Login / Register]({{DOCS_BASE_URL}}/en/login-register)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
