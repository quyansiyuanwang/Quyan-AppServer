# Forgot password

Use this page when you can identify your account but can no longer sign in with the old password.

## Page purpose

- Verify account ownership.
- Send a recovery code to the bound email.
- Set a new password safely.

## What you will see

### Account fields

- Username field.
- Email field.
- A button to send the verification code.

### Recovery fields

- Segmented verification-code input.
- New password and confirm-password fields.
- Reset and back actions.

## Common actions

1. Enter the username and the correct email address.
2. Request a verification code.
3. Check your mailbox and enter the six-digit code.
4. Enter a new password of 6–50 characters, then enter it again to confirm.
5. Submit the reset request. On success, the page redirects you to sign in.

## Notes

- The code validity period follows the email and server configuration. If the code is invalid or expired, request another one. The page displays a 60-second cooldown after sending; the server may also impose additional limits or require a verification challenge.
- If the connection is interrupted after submission or the result is uncertain, the reset may have completed. Return to sign-in and try the new password first. If submission failed or you still need to reset it, the code may already have been used; request a new code before submitting again. Wait for the send-button cooldown if it is still running.
- If the email does not arrive, check your spam folder and confirm you entered the bound address. If it still does not arrive, ask an administrator to check the email service. Contact an administrator if you cannot access the bound mailbox.
- The username and email must belong to the same account.
- The **Reset** button clears the form. Use the submit button to change the password.
- After a successful reset, sign in again with the new password.

## Related pages

- [Login / Register]({{DOCS_BASE_URL}}/en/login-register)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
