# Verification

The verification product sends email or SMS codes for your application and provides a one-time verification API. Successful verification means the code was valid and has been consumed; your application performs the registration, sign-in, profile change, or other business action. For platform account challenges, see [Security verification]({{DOCS_BASE_URL}}/en/auth-verification).

## Prerequisites

- Activate the verification product and create an enabled instance. The product and account must be available.
- Create a product API key for that instance. Sending requires `product:verification:send`; verification separately requires `product:verification:verify`. Both the key's grants and its bound identity's effective permissions must allow the action.
- Ask the platform administrator to configure the required delivery channel: platform SMTP for email or an enabled SMS provider.

Product APIs require a product key. A sign-in token, AccessKey, or relay token cannot replace it. Store the key on your backend and restrict recipients and purposes through your application; do not embed it in a public website or mobile application. See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview) for instance and key creation.

## Send and verify in the console

1. Open the verification product console, open an instance's details, and enter a product API key in the test card.
2. Select email or SMS and enter a recipient and purpose, such as `signup`. Enter an actual purpose: the placeholder is not a default value.
3. Select Send verification. Check for `success: true` and whether the recipient received the message.
4. Keep the same channel, recipient, and purpose. Enter the received six-digit code and select Verify code.
5. Check `valid` in the new result: `true` means verification passed; `false` means it did not. The request-success message also appears for `valid: false` and cannot establish successful verification by itself.

Tests use the instance and account belonging to the key you enter, which can differ from the open instance. Changing inputs does not clear the old result. Client-side validation failures also retain it. Submitting valid inputs clears it; judge this operation from the new response.

Tests make real requests, deliver real messages, and follow send metering rules. Usage and call records do not refresh automatically after a test. Close and reopen the instance details to reload them. The page's top-level refresh only reloads the instance list.

## Integrate the API

Send a code:

```http
POST /v1/products/verification/send
Authorization: Bearer <PRODUCT_API_KEY>
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup" }
```

After receiving it, verify with a key for the same instance that has verification permission. Replace `123456` with the received code:

```http
POST /v1/products/verification/verify
Authorization: Bearer <PRODUCT_API_KEY>
Content-Type: application/json

{ "channel": "email", "recipient": "user@example.com", "purpose": "signup", "code": "123456" }
```

Send requests to your deployment's API service address and replace `<PRODUCT_API_KEY>` with your key. Check both the HTTP status and the response business code. On API success, the send result is `data.success` and the verification result is `data.valid`. The console test card displays the contents of `data` directly.

| Parameter   | Requirement                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `channel`   | `email` or `sms`; use the same value for sending and verification                                       |
| `recipient` | 3–320 characters after trimming; use an email address or phone number supported by the channel provider |
| `purpose`   | 1–100 characters after trimming; defined by your application and identical for sending and verification |
| `code`      | Required only for verification; a string of exactly six digits, not a number                            |

Codes belong to an instance. Different keys for that instance can send and verify together when appropriately authorized. A key for another instance cannot verify the original instance's code. There is no API for retrieving the plaintext code.

## Expiry, resending, and attempts

- Codes expire 10 minutes after generation, which happens before delivery. Delivery delays reduce the time remaining after receipt. The page has no expiry countdown.
- Each code allows up to five incorrect attempts. It cannot pass once attempts are exhausted. Malformed requests return a parameter error.
- Successful verification consumes the code immediately. It cannot be reused, and concurrent submissions of the correct code can succeed only once.
- Successfully sending a new code to the same recipient for the same purpose in an instance invalidates older codes, even across different channels. Use the latest successfully sent code.

If verification times out or is interrupted without a definite result, the code may already have been consumed. Do not treat an unknown outcome as successful verification. If needed, wait until sending is allowed and send a new code. Associate verification with the recipient, purpose, and business action in your application.

## Send frequency and delivery outcomes

Current send limits use saved send records from the last 10 minutes within an instance. Consumed or expired codes still count while their records remain in that window.

| Scope                                 | New sends are rejected at this record count   |
| ------------------------------------- | --------------------------------------------- |
| One instance                          | 20                                            |
| Same instance, recipient, and purpose | 3, combining email and SMS                    |
| Same instance and source IP           | 10, when the server obtains a valid source IP |

These controls limit frequent sends and do not replace your application's own business rate limits. After rejection, wait for older records to leave the window. Avoid repeatedly selecting resend.

Acceptance by SMTP or the SMS provider does not guarantee final delivery. When the SMS endpoint returns HTTP success, the platform does not additionally evaluate delivery status in the provider response body. The current console has no delivery-receipt query, template editor, or automatic channel failover.

A send error does not necessarily mean no message was sent: saving the code or recording the call can fail after delivery, and a received code may be unusable. Resolve the error and, when resending is allowed, use the latest successfully sent code. For persistent delivery problems, ask the administrator to check the channel instead of repeatedly retrying.

## Usage and charges

Sending counts toward product usage. Verification does not count toward that usage and does not create the same product call records. Key request counts can still increase for verification, so they do not equal billable sends or successful verifications.

The account's verification instances share daily quota, counted by the server's calendar date. Free quota, overage settings, and unit prices follow the current product configuration. Requests can still be counted when the unit price is zero. Sending reserves quota before execution; subsequent failures enter a refund process that can be delayed. Ask an administrator to investigate persistent discrepancies in usage or charges.

The usage panel shows at most the latest 200 call records for the account and product, which can include other instances and earlier dates. Requests rejected during authentication, parameter validation, or quota checks may have no record. The list is not a complete delivery register.

## Troubleshooting

| Symptom                                   | Action                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Authentication or permission failure      | Check that the product key is enabled and unexpired, then check separate send/verify grants and its bound identity's permissions |
| API succeeds but `valid` is `false`       | Check the instance, channel, recipient, purpose, latest code, expiry, consumption, and remaining attempts                        |
| Sending is too frequent                   | Wait for records to leave the rolling 10-minute window; changing channel does not reset the recipient/purpose limit              |
| SMTP is not configured or SMS is disabled | Ask an administrator to configure the channel before resending                                                                   |
| Send succeeds but no message arrives      | Check spam folders, recipient format, and provider delivery status; acceptance is not delivery                                   |
| Usage does not change after testing       | Reopen instance details and check the entered key's account; verification itself does not count toward product usage             |

Related: [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview), [API documentation]({{DOCS_BASE_URL}}/en/api-documentation).
