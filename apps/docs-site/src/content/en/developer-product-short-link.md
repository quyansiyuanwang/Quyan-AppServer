# Short Link

Short Link maps a controlled destination URL to a compact code. It is suited to campaigns, downloads, attribution, and shared links that need central expiry or suspension. Links are isolated by instance and are created, edited, and analyzed in the product Console.

## Create and publish

Provide a complete HTTP(S) target URL. You may use a platform-generated code or a custom 3-80 character lowercase letter, digit, and hyphen alias. An optional expiry makes the link stop working at that time. After creation, select Copy in the list to obtain the full public URL. You can pause or resume a link and edit its destination or expiry, but you cannot change its code in the edit dialog. Deletion requires confirmation and makes the link unusable.

The public address is `GET /s/{code}`. It returns a native `302` redirect without an API key or JSON response wrapper. Paused, expired, and missing codes do not redirect. Public redirects count toward the product instance’s usage. Available quota, overage prices, and balance requirements depend on the current product configuration; a disabled instance or product, insufficient quota, and other restrictions can also prevent redirects.

## Analytics and privacy

Successfully processed redirects record the click time, visitor IP, referrer host, User-Agent, and country/region supplied by the request. The analytics page shows lifetime clicks and, for the latest 30 calendar days including today up to the query time, visit counts, distinct IP counts, daily and hourly trends, IP and source rankings, and paginated visit details. Times use UTC+8. Distinct IPs are deduplicated by IP address and do not equal distinct people. Lifetime clicks are not limited to this 30-day window; click details are cleaned up after 90 days, so lifetime clicks can differ from recent record counts. Analytics contains visitor information; grant access only to identities that need it.

Short Link read, write, and delete operations are controlled by separate RAM actions.

## JWT project management authorization

An individual Short Link uses `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`. The final segment is the stored link ID; the public code is not its IAM identity. Copy resourceArn from a response into a JSON policy.

`quyan:developer:CreateShortLink` controls creation on the project ARN without automatically granting management of the new link. `ListShortLinks`, `UpdateShortLink`, `DeleteShortLink`, and `GetShortLinkStats` independently check the specific link ARN. The statistical Action controls visitor details separately; listing alone never grants analytics access.

`GET /v1/developer/projects/{projectId}/short-links/page` accepts page/pageSize and returns items, page, pageSize, and hasNext. Candidates from the active same-account project are paginated before each link is filtered. Empty pages may have a next page, with no unauthorized total. The old array list returns only the default first page in enforce. Authorized identities can still manage paused or expired links, while disabled database rows and foreign-account resources are inaccessible.

Links may join resource groups; removal changes authorization on the next request. Delegation preserves the project owner, and URL validation continues to block internal addresses and credentials in URLs. legacy/shadow retain personal project ownership; enforce uses resource policies. Product-instance management and public redirects keep their existing identity and permission boundaries. See [RAM management](./ram-management) for further rules.
