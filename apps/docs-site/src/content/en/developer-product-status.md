# Status Monitoring

Status Monitoring periodically checks public HTTP(S) services and exposes a public status page. It is suited to API, website, and dependency availability and latency, not a replacement for full application performance monitoring or log analytics.

## Configure monitors

Set a name, target URL, `GET` or `HEAD` method, interval, and accepted status codes in the Console. The minimum interval is 60 seconds. Requests pass SSRF protection: only HTTP(S) is allowed, private, loopback, and link-local targets are rejected, and redirects and response bodies are bounded.

Check records include status code, latency, and a sanitized error summary. A target can be paused, resumed, or checked manually. Outage and recovery events can use the platform notification/webhook system.

## Public status page

After publication, the page is available at `/status/{slug}` and shows current state, recent latency, availability, and incident history. Turning publication off removes public access. Publishing has its own RAM action, separate from monitor read, write, and delete actions.
