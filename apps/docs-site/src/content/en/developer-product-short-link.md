# Short Link

Short Link maps a controlled destination URL to a compact code. It is suited to campaigns, downloads, attribution, and shared links that need central expiry or suspension. Links are isolated by instance and are created, edited, and analyzed in the product Console.

## Create and publish

Provide a complete HTTP(S) target URL. You may use a platform-generated code or a custom 3-80 character lowercase letter, digit, and hyphen alias. An optional expiry automatically disables campaign links. Links can be paused, resumed, retargeted, or permanently removed.

The public address is `GET /s/{code}`. It returns a native `302` redirect without an API key or JSON response wrapper. Paused, expired, and missing codes do not redirect.

## Analytics and privacy

Each redirect asynchronously aggregates the click time, referrer host, a User-Agent summary, and country/region. The Console provides date, source, and region summaries; details are cleaned according to the product retention policy. Analytics responses may include visitor IP addresses, referrer hosts, and User-Agent details. Grant analytics access only to identities that need it.

Short Link read, write, and delete operations are controlled by separate RAM actions.

## JWT project management authorization

An individual Short Link uses `acs:developer:*:<accountId>:short-link/<projectId>/<linkId>`. The final segment is the stored link ID; the public code is not its IAM identity. Copy resourceArn from a response into a JSON policy.

`quyan:developer:CreateShortLink` controls creation on the project ARN without automatically granting management of the new link. `ListShortLinks`, `UpdateShortLink`, `DeleteShortLink`, and `GetShortLinkStats` independently check the specific link ARN. The statistical Action controls visitor details separately; listing alone never grants analytics access.

`GET /v1/developer/projects/{projectId}/short-links/page` accepts page/pageSize and returns items, page, pageSize, and hasNext. Candidates from the active same-account project are paginated before each link is filtered. Empty pages may have a next page, with no unauthorized total. The old array list returns only the default first page in enforce. Authorized identities can still manage paused or expired links, while disabled database rows and foreign-account resources are inaccessible.

Links may join resource groups; removal changes authorization on the next request. Delegation preserves the project owner, and URL validation continues to block internal addresses and credentials in URLs. legacy/shadow retain personal project ownership; enforce uses resource policies. Product-instance management and public redirects keep their existing identity and permission boundaries. See [RAM management](./ram-management) for further rules.
