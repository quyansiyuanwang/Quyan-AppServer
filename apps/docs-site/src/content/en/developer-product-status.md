# Status Monitoring

Status Monitoring periodically checks public HTTP(S) services and exposes a public status page. It is suited to API, website, and dependency availability and latency, not a replacement for full application performance monitoring or log analytics.

## Configure monitors

Set a name, HTTP(S) target URL, method, interval, accepted status codes, and an alert delay (1 to 1,440 minutes; 5 minutes by default) in the Console. The minimum interval is 60 seconds. Requests pass SSRF protection: only HTTP(S) is allowed, private, loopback, and link-local targets are rejected. Status checks follow up to five HTTP redirects, validating every destination again, and reject redirect loops and non-HTTP schemes such as `file://`.

Check records include status code, latency, and a sanitized error summary. A target can be paused, resumed, or checked manually; a manual check only affects the selected row. An outage notification is sent only after the configured delay and only once per outage. Recovery notifications use the platform notification/webhook system and existing notification preferences.

## Public status page

After publication, the page is available at `/status/{slug}` and shows current state, recent latency, availability, and incident history. Turning publication off removes public access. Publishing has its own RAM action, separate from monitor read, write, and delete actions.
