# Short Link

Short Link maps an HTTP(S) destination to a compact code for campaigns, downloads, and attribution. Manage links within an instance, update destinations, set expiry, and inspect access statistics.

## Prerequisites

Create an enabled Short Link product instance and obtain the required permissions:

| Operation                              | Product permission          |
| -------------------------------------- | --------------------------- |
| List, copy URLs, and view statistics   | `product:short_link:read`   |
| Create, edit, enable, or disable links | `product:short_link:write`  |
| Delete links and manage instances/keys | `product:short_link:manage` |

IAM enforcement mode also checks listing, creation, modification, deletion, and statistics separately. Statistics include visitor data; grant access only where needed. See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview) for instances and authorization.

Management uses the console sign-in identity. Public access requires no product API key. Resources are managed by instance, but public codes are unique across the deployment; separate instances cannot reuse the same custom code.

## Create and share

1. Open the Short Link product console, open the target instance's details, and select Create Short Link.
2. Enter a complete destination URL of up to 2,000 characters. Use HTTP or HTTPS without embedded username/password. The hostname must resolve; private or reserved addresses can be rejected.
3. Optionally enter a custom code of 3–80 lowercase letters, digits, or hyphens. Leave it blank for a generated code. Choose another if it is already in use.
4. Optionally set expiry. Use a future time for immediate availability; a past expiry creates a link that cannot redirect.
5. Save, select Copy in the list, and wait for the copy-success message before sharing the complete URL.

The public entry point is `GET /s/{code}` on your deployment's API service. If copying fails, check clipboard permission and browser secure-context support. If the copied URL is invalid, ask an administrator to check the console API address configuration rather than guessing a domain.

Enabled status represents the link switch only. It does not guarantee unexpired access or available quota. Test the URL before sharing; that test is a real access and counts toward product usage.

## Edit, pause, and delete

- **Edit**: change the destination or expiry while keeping the code. Clearing expiry and saving removes the old deadline. Editing uses loaded list data; reload first after leaving the page open for a long time.
- **Disable or enable**: the button submits immediately, without another confirmation. Disabling blocks subsequent public redirects. Enabling does not remove expiry; adjust it separately for an expired link.
- **Delete**: confirmation is required. Deletion removes the link and its click details, without console recovery. It does not permanently reserve the code. A later link with that code can give the original URL a destination again.

Changing the destination affects later requests to the same short URL; previous redirects cannot be recalled. An in-progress request may finish before disabling or deletion takes effect. To retain control of a code over time, disable the link and retain its record.

Creating, editing, toggling, and deleting reload the list. If refreshing fails, old data can remain even with a success message. Select Retry in the error and check the result. There is no polling. The top-level refresh reloads only instances; close and reopen details to reload links.

After a timeout or interrupted connection, reload and confirm the outcome before retrying. Repeating creation with a generated code can create multiple links. A timeout does not establish that creation failed.

## Public redirects and charges

Successful public access returns a native `302` with a `Location` destination, without a JSON success envelope or caller key. The platform does not proxy the destination's content. Returning a redirect does not prove the visitor opened the destination successfully.

Paused, expired, deleted, instance-disabled, or product-disabled links do not redirect normally. Insufficient quota/balance or call-record failures can also block redirection. Being able to manage a link does not establish that its public URL is available.

Public redirect processing is metered under Short Link product rules. Instances in the same account share daily quota, counted by the server's calendar date. Free quota, overage settings, and unit prices follow current product configuration. Repeat visits, previews, and automated requests can also generate usage. Requests are still counted at zero unit price; refunds after execution failures can be delayed.

Console creation, editing, and statistics do not use public-redirect metering. Click records are saved before returning the redirect. Statistics can therefore exist even if the client receives no redirect or subsequent call logging fails. Do not treat click counts as people who reached the destination or as billed call counts.

## View access statistics

Select Statistics for a link in the instance list. The page covers the latest 30 calendar days, including today up to the query time, in UTC+8. It has no custom date range, export, or automatic refresh. Refresh reloads the current page and summaries.

| Metric               | Meaning                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Lifetime clicks      | Stored historical click count, beyond the 30-day window                              |
| Period visits        | Click records within the latest 30 calendar days                                     |
| Distinct IPs         | Different IP addresses in the period, not distinct people; missing IPs are excluded  |
| Daily trend          | Aggregated by UTC+8 date; dates without records may be absent                        |
| Hourly trend         | Aggregates all dates by hour of day, rather than a continuous 30-day hourly timeline |
| Rankings and details | Up to 20 IPs and 10 referrer hosts; details have 25 records per page, newest first   |

Sources retain only the Referer hostname, not the full path. Missing or unparsable sources appear as direct visits; this does not prove manual URL entry. Country/region comes from request-supplied information rather than verified IP geolocation. User-Agent and other fields can be absent or truncated.

A statistics failure shows an error and hides the content. Refresh before reading it again. Pages and summaries use live queries; new visits during pagination can change results, so they are not a fixed snapshot.

A background task removes click details older than 90 days; actual cleanup timing depends on task execution. Lifetime counts are retained. Deleting the link also deletes its details. Statistics include visitor IPs, times, and client information, so control access according to business needs.

## Management API and granular authorization

The instance console uses a sign-in session with `GET /v1/products/short_link/instances/{instanceId}/links`. It checks `quyan:developer:ListShortLinks` on the backing project and returns the instance's list without per-link filtering. Creation requires project-level `CreateShortLink`. Updates, deletion, and statistics check `UpdateShortLink`, `DeleteShortLink`, and `GetShortLinkStats` on the specific link.

For a per-link filtered list, use `GET /v1/developer/projects/{projectId}/short-links/page`. It accepts `page` and `pageSize` and returns `items`, `page`, `pageSize`, and `hasNext`, without `total`. IAM enforcement mode paginates candidates before checking link authorization. An empty page can still have a next page. The old array list returns only the default first page.

A link's ARN is `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`. The final segment is the link ID, not the public code. Prefer `resourceArn` from project-management responses. Creation does not automatically grant subsequent management of the new link; listing does not automatically grant visitor statistics. Authorized identities can still manage paused or expired links. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management).

## Troubleshooting

| Symptom                                                   | Action                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Creation fails or code conflicts                          | Check deployment-wide code availability and destination format, resolution, and allowed address scope |
| Enabled link fails to redirect                            | Check expiry, instance/product state, quota, and balance                                              |
| Statistics are unavailable or denied                      | Check the separate statistics action; a visible list does not grant visitor details                   |
| Lifetime clicks differ from period records                | Time ranges differ and old details may have been cleaned; counts also do not prove destination access |
| A list remains after instance switching or failed refresh | It may be previous data; reload successfully before editing or deleting                               |
