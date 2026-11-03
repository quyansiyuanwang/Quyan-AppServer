# IP Geolocation

IP Geolocation looks up a public IP's country, region, city, ASN, and carrier information for regional display and business risk signals. Results depend on provider data and caching; they do not establish a user's exact location or identity.

## Requirements

1. Open **IP Geolocation** under developer products, select an available instance, and open its details.
2. Prepare an API key for that product instance. Both the key and its bound principal need `product:ip_geolocation:lookup`. Removing the principal's permission also prevents existing keys from performing lookups.
3. Confirm that the instance, product, and principal are available, the key is unexpired and not revoked, and quota or balance is sufficient.
4. Prepare one public IPv4 or IPv6 address. Supply a single IP rather than a hostname, URL, or subnet. Provider coverage also determines which address families yield usable data.

See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview) for instance and key creation. The lookup endpoint uses a product API key; browser login credentials, access keys, and relay tokens do not replace it.

## Test in the console

1. Open the IP lookup test card inside instance details.
2. Enter the complete product API key and public IP.
3. Click **Lookup IP** and wait for the request to finish.
4. Check `ip`, `source`, and location fields before using the result.

Tests use real credentials, permissions, quota, and overage rules. They are not simulated. Enter keys only on trusted devices and avoid screenshots containing credentials. The test does not automatically select a key from your browser login.

Changing inputs does not immediately clear an old result. If the key or IP is empty, client validation shows an error and can retain that result. Starting a request with nonempty inputs clears it. Confirm that the new request succeeded before treating the display as the current IP's location.

Lookups do not automatically refresh the adjacent usage and call records. Close and reopen the instance drawer to check them. The page's top refresh mainly reloads instance information and does not establish that usage was refreshed. Use the usage panel's retry action after a load failure; old values or empty records do not establish no calls.

## Call the API

Set `API_BASE_URL` to the deployment's backend API address and `PRODUCT_API_KEY` to a product key with lookup access, then run this Bash example on your server. Do not substitute the management-console host or public status-page address.

```bash
curl "${API_BASE_URL}/v1/products/ip-geolocation/8.8.8.8" \
  -H "Authorization: Bearer ${PRODUCT_API_KEY}"
```

The endpoint is `GET /v1/products/ip-geolocation/{ip}`. The IP is one path parameter; encode it when building requests programmatically. This endpoint offers no batch IP lookup, hostname resolution, or automatic lookup of the current visitor's address.

Responses use the platform envelope. Check both the HTTP status and business `code`; successful data is in `data`. The console test card shows only `data`, rather than the complete response. See [API documentation]({{DOCS_BASE_URL}}/en/api-documentation) for general error handling.

| Data field | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `ip`       | The queried IP.                                                                     |
| `country`  | Country or country name.                                                            |
| `region`   | Province, state, or region.                                                         |
| `city`     | City.                                                                               |
| `asn`      | Provider-supplied ASN information, or `null` when unavailable.                      |
| `isp`      | Provider-supplied carrier or organization information, or `null` when unavailable.  |
| `source`   | `configured` for the configured generic provider, or `baidu` for the Baidu adapter. |
| `address`  | A full address the Baidu adapter may return; not supplied by every source.          |

Missing values can be `null` without making the request a failure. Contents and types can vary by provider. Allow missing data and do not assume ASN is always numeric or city is always available. Successful queries do not guarantee accurate or current location data.

## Cache and data sources

Repeated requests can use the platform cache without another provider call, while still counting as product usage. Neither the form nor lookup endpoint offers a bypass-cache option. Repeating a query does not guarantee an immediate location or source update.

Deployment administrators configure the source; ordinary product instances cannot select one:

- The generic HTTP(S) provider in `IP_GEOLOCATION_ENDPOINT` takes precedence.
- The Baidu adapter is used only when that endpoint is empty and `BAIDU_IP_LOCATION_AK` is configured. Callers do not supply the provider key.
- A generic provider failure does not automatically fall back to Baidu. If neither is configured, uncached requests fail, although older cached results can still be returned.

On success, the Baidu adapter returns China, provider-supplied province and city, and address data. Its `asn` and `isp` are `null`. This does not establish coverage for every country or address family; inspect the actual result.

Provider requests have a 5-second timeout and 1 MiB response limit and do not follow redirects. Contact an administrator for provider unavailability, invalid responses, or deployment configuration errors; repeating requests may not resolve them.

## Usage and charges

- IP Geolocation instances in the same account share product daily usage and free quota. Days follow the server's calendar date, rather than the browser's local date.
- Free quota, overage settings, and prices follow current account entitlement and server configuration. Disabled overage or insufficient balance can reject a request.
- A zero-price product still records usage but does not reject queries because daily free quota is exhausted. The panel can display unlimited remaining quota.
- Successful cache hits still count as product calls. A key's call count also differs from successful lookups: failures after authentication can increase that count.
- The product endpoint meters first, then performs the lookup. Execution failures enter quota and charge refund processing, which can be delayed. Authentication or quota failures should not be treated as successful lookups.

Call records show at most the latest 200 account-product entries, potentially across instances and dates. They are not a complete billing export and may omit requests that failed before authentication or metering. The key entered in the test determines the account and instance used, rather than the currently open drawer. Confirm account consistency when reconciling usage.

## Troubleshooting

| Symptom                                           | Action                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public-IP-only error                              | Enter one valid IP. Private, loopback, and platform-blocked reserved addresses are not sent to a provider. Use a public address needed by your business.                 |
| Invalid key or insufficient permission            | Check the product, expiry or revocation, instance and principal availability, and lookup permission on both key and principal.                                           |
| Service not configured or provider request failed | Ask the deployment administrator to check the source. Supplying a provider key in the product instance will not resolve it.                                              |
| Missing ASN, carrier, or city                     | Check `source` and provider coverage. `null` can be a valid success result; do not retry indefinitely.                                                                   |
| Usage or balance has not been restored            | Reload usage and [Balance history]({{DOCS_BASE_URL}}/en/balance-history). Retain failure time and response details, and contact an administrator if differences persist. |

An uncached lookup sends the IP to the configured third-party provider. Query only addresses needed by the business, check personal or business information before sharing results, and do not use geolocation as the sole basis for access authorization.

## Related documentation

- [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
- [Balance history]({{DOCS_BASE_URL}}/en/balance-history)
