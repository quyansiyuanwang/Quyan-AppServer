# Verification

When login, registration, security changes, or high-risk actions require 2FA, a full-screen verification overlay appears over the current page, preserving unsaved edits. The standalone `/auth/verify` screen remains available for direct access. Captcha uses its separate `/auth/captcha` page.

## Complete second-factor verification

1. Read why the current action needs verification.
2. Select the available method you want to use.
3. Enter the requested code.
4. Submit and wait for sign-in to finish or the original action to resume. Check the final result on the original page; successful verification does not guarantee that the original action succeeded.

### Choose a code method

- For an authenticator app, enter its six-digit code. If the app is unavailable, select **Use a recovery code instead** under that method and enter a saved recovery code; each recovery code can be used once.
- For email verification, switch to the email method, select **Send email code**, and submit the six-digit code you receive. After a successful send, the button has a 60-second cooldown; sending may first require a captcha.
- The verification screen for disabling 2FA accepts an authenticator code or recovery code and does not offer the email method.

Email codes go to the address already bound to the account. After sending, the page displays a masked address; you cannot specify a different recipient here. If no email is bound or you cannot access it, use an authenticator code or unused recovery code.

## Complete a captcha

Sign-in, registration, verification-code sends, password recovery, and password reset may require a captcha first. Follow the verification component's prompts. The standalone `/auth/captcha` page uses Turnstile and returns to the original entry after success.

Passing the captcha satisfies the human-verification requirement for the action; it does not complete sign-in or identity verification. Repeated captchas may be skipped within the configured trust window, subject to current server configuration.

## Troubleshooting

| Symptom                                               | Action                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An authenticator code is rejected                     | Check that you selected the authenticator entry for this account, verify your device clock, and enter the current six-digit code.                                                                                               |
| A recovery code is rejected                           | Check that the code has not been used. Each recovery code works once; do not submit it together with an authenticator code.                                                                                                     |
| No email code arrived                                 | Check the masked recipient address and spam folder. Wait for the cooldown before resending. If sending fails, complete any requested captcha or contact an administrator to check email delivery.                               |
| The action is rate-limited                            | Wait as directed before retrying. Registration, password recovery, 2FA verification, and code sending have separate server limits. The end of the 60-second button cooldown does not guarantee that server limits have cleared. |
| The verification challenge is missing or expired      | Restart sign-in or the original action to obtain a new challenge instead of repeatedly submitting an old code. Opening the standalone verification page directly does not create a challenge.                                   |
| Verification succeeded but the original action failed | Read the original page's error and resolve permission, input, or service issues. If the outcome is unclear, check whether the action took effect before retrying.                                                               |

## Notes

- The overlay can appear during login, registration, disabling 2FA, email changes, or step-up security checks. After step-up verification, pending requests resume on the same page without remounting it.
- After a refresh, the overlay reappears if a verification challenge is still pending; unsaved page data and pending original requests do not survive the refresh. Restart the original action after verification or if the challenge has expired.
- Recovery codes should be stored offline; each code can only be used once.
- If policy consent is shown here, finish reading it before continuing.
- The standalone verification page provides a back button; the full-screen overlay cannot be dismissed with the backdrop, Escape, or an on-screen back button.

## Related pages

- [Login / Register]({{DOCS_BASE_URL}}/en/login-register)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [2FA & passkeys]({{DOCS_BASE_URL}}/en/two-factor-authentication)
