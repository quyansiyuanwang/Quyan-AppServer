# Login / Register

Use this page to sign in to an existing account or create a new one.

Sign-in, registration, password recovery, social-login callbacks, two-factor verification, and passkey authentication all finish on the authentication site. When you open a protected page from a product site, you are sent there and then returned safely to the original page. Login tokens are never placed in the URL.

## Page purpose

- Switch between login mode and register mode on the same screen.
- Submit account credentials securely.
- Open password recovery when you cannot sign in.
- Review legal-policy consent before finishing registration.

## What you will see

### Login mode

- Username and password fields.
- A direct entry to the password reset page.
- A passkey sign-in option when your account already supports it.

### Register mode

- Username, nickname, email, verification code, password, and confirm-password fields.
- A checkbox or consent area for terms and privacy policies.
- Verification-code sending controls.

## Common actions

1. Choose **Login** if you already have an account.
2. Choose **Register** if you are creating a new account.
3. Fill in the required fields shown for the current mode.
4. Read the policy links before accepting them.
5. Submit the form and continue to the next step if verification is required.

## Notes

- Registration normally needs a valid email address and verification code.
- If passkey sign-in is available, it can reduce repeated password entry.
- If you cannot remember your password, use the dedicated recovery page instead of creating a duplicate account.
- After authentication, each product site restores its own protected session. Do not treat browser storage as a cross-site sign-in mechanism.

## Related pages

- `forgot-password`
- `auth-verification`
- `account-settings`

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
