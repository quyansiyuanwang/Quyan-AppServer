# Short Link

Short Link maps a controlled destination URL to a compact code. It is suited to campaigns, downloads, attribution, and shared links that need central expiry or suspension. Links are isolated by instance and are created, edited, and analyzed in the product Console.

## Create and publish

Provide a complete HTTP(S) target URL. You may use a platform-generated code or a custom 3-80 character lowercase letter, digit, and hyphen alias. An optional expiry automatically disables campaign links. Links can be paused, resumed, retargeted, or permanently removed.

The public address is `GET /s/{code}`. It returns a native `302` redirect without an API key or JSON response wrapper. Paused, expired, and missing codes do not redirect.

## Analytics and privacy

Each redirect asynchronously aggregates the click time, referrer host, a User-Agent summary, and country/region. The Console provides date, source, and region summaries; details are cleaned according to the product retention policy. Full visitor IP addresses are not stored, so this service must not be your sole security-audit or identity signal.

Short Link read, write, and delete operations are controlled by separate RAM actions.
