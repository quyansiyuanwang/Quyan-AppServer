# Login / Register

Use this page to sign in to an existing account or create a new one.

Sign-in, registration, password recovery, social-login callbacks, two-factor verification, and passkey authentication all finish on the authentication site. Opening a protected product page takes you there. A valid return flow brings you back after sign-in; an expired flow may lead to the account area instead. Login tokens are never placed in the URL.

## Sign in with a username and password

1. Choose **Login** and enter your username and password.
2. Read and accept the policies shown on the page, then submit.
3. If a CAPTCHA or two-factor verification is required, follow the prompts.

Use your username, rather than your nickname or email. If you forgot the password, use [password recovery]({{DOCS_BASE_URL}}/en/forgot-password) instead of registering again. **Reset** only clears the current form; it does not change the account password.

## Sign in with a passkey

1. Confirm that your browser or credential manager can use a passkey registered for this account.
2. Read and accept the policies shown, then select the passkey sign-in button. You do not need to fill in a username and password first.
3. Follow the browser prompts to select a credential and verify on your device. Complete 2FA if requested.

The button appears based on browser capability; it does not guarantee an available credential on this device. Cancelling browser verification does not sign you in. Try again or use another existing account method. See [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management) to register a new credential.

## Sign in with an external account

If GitHub or WeChat entries are shown, select the provider, complete authorization on its platform, and follow any policy-consent or 2FA prompts.

The external account must be bound to an account on this site. If prompted to bind it, sign in using an existing method and finish binding in **Settings → Account Security** before using external sign-in. Successful provider authorization alone does not complete sign-in to this site.

## Sign in with a QR code

If QR sign-in is enabled for your deployment, you can approve a sign-in request from another device signed in to your account:

1. Select **QR sign-in** on the login page and scan the displayed code with the other device.
2. If that device is not signed in, sign in to the account you want to use and return to the approval page.
3. Check the requesting device summary, IP address, and approximate location. If you initiated the request, select **Allow this sign-in**; otherwise, select **Deny this sign-in**.
4. Return to the original login page and follow any prompts for policy consent or two-factor verification. If the code expires, select **Refresh** on the original login page to generate a new one.

## Register an account

1. Choose **Register**. If registration is unavailable, ask an administrator whether it is enabled.
2. Enter your username, nickname, and email address. Request a verification code and enter the six-digit code from the email.
3. Enter and confirm your password, read and accept the policies shown on the page, and submit.
4. On a normal successful registration, the page switches back to login. If additional verification is requested, follow the prompts first.

| Field                     | Requirement                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Username                  | 3–20 letters, digits, or underscores; must not duplicate an existing username.                                                                   |
| Nickname                  | The web form requires 1–30 Chinese characters, letters, digits, or spaces, without leading or trailing spaces. This is not the sign-in username. |
| Email and code            | Use an accessible mailbox and the six-digit code sent to that address. If you change the email field, request a code for the new address.        |
| Password and confirmation | Use 6–50 characters and enter the same password in both fields.                                                                                  |

A successful code send starts a 60-second cooldown. Separate server sending limits may also apply. Registration availability and the account limit per email depend on current server configuration.

## Notes

- Registration requires access to an email address and a valid email verification code. Request another code if it expires or does not arrive; check your spam folder or contact an administrator if email still does not arrive.
- Switching between sign-in and registration resets the form. Check whether you still need the current input before switching.
- After authentication, each product site restores its own protected session. Do not treat browser storage as a cross-site sign-in mechanism.

## Troubleshooting

| Symptom                                                | Action                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Username or password is rejected                       | Check that you entered the username. Use password recovery if you forgot the password.                                                               |
| The account is disabled or access is denied            | Ask an administrator to check account status and target-page permissions. Clearing cache does not restore authorization.                             |
| The email account limit was reached                    | Sign in to an existing account, or ask an administrator about the current limit. Receiving a code does not guarantee a remaining registration slot.  |
| A code is invalid after retrying a failed registration | Check the email field and request a new code; the previous submission may have consumed it.                                                          |
| External authorization callback fails                  | Return to sign-in and start authorization again instead of repeatedly refreshing the same callback URL. Provider authorization codes are single-use. |
| Successful sign-in did not return to the original page | Open the target page again from the product site. The return flow may have expired, and the target page still requires access permission.            |

## Trouble signing in: check and repair

Use **Unable to sign in? Check and repair** on the sign-in page. If the main application cannot open, use the recovery link beneath its loading screen or visit `/repair.html` on the current site.

1. Start with **Check browser environment**. It checks storage access, known sign-in data formats, databases and backend connectivity without uploading local contents. Normal results cannot rule out every issue; the page cannot inspect HttpOnly cookies.
2. Prefer **Reset sign-in state**. After confirmation, it removes local authentication remnants while keeping language, theme and business caches. CAPTCHA and trusted-device cookies are reset, so verification may be required again. Account Passkeys and two-factor configuration are not deleted.
3. If necessary, choose **Clear this app’s local data**. Two confirmations are required before removing recognized application storage, preferences and databases on this origin. Save unsynced drafts first. Server-side accounts and business data are unaffected.
4. Review each result and select **Return to sign in**. Retry incomplete operations. Local cleanup continues even when the backend is unreachable; this does not mean authentication cookies were cleared.

**Limits and troubleshooting:**

- Only recognized data on the current origin is handled. Visit other subdomains separately to clear their LocalStorage and IndexedDB. Shared cookies may affect other sites in the same deployment.
- Close other tabs for this site if database deletion is blocked. Unsupported database enumeration is reported as incomplete coverage.
- If storage is restricted or automatic cleanup fails, search browser settings for “site data,” select only this site, clear its data and reopen sign-in. Do not accidentally clear data for every website.
- Resetting does not fix incorrect passwords, account permissions, network outages or server faults. Follow the corresponding sign-in error instructions instead.

## Related pages

- [Forgot password]({{DOCS_BASE_URL}}/en/forgot-password)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management)
