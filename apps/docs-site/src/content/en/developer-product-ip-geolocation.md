# IP Geolocation

IP Geolocation normalizes a public IP into country, region, city, ASN, carrier, and data-source fields. It is suitable for regional presentation, risk signals, and content localization. Results are cached to reduce latency and provider traffic; successful cache hits still count toward product usage.

## Data sources

The platform first uses the generic HTTP(S) provider configured by `IP_GEOLOCATION_ENDPOINT`. When that endpoint is empty and `BAIDU_IP_LOCATION_AK` is configured, it uses the Baidu IP Geolocation adapter. The key does not need to be sent to the client or stored in a product instance. If neither is configured, lookups fail; a configured provider failure does not automatically fall back to Baidu.

The Baidu adapter returns China, province, city, and a full address when supplied by Baidu. Baidu does not provide ASN or carrier data in this response, so those normalized fields are `null` and the data source is `baidu`.

## API

The IP lookup action is required:

```http
GET /v1/products/ip-geolocation/8.8.8.8
Authorization: Bearer sk-dpk-...
```

The response supplies country, region, city, ASN, carrier, and data source where the provider has data. The Baidu adapter may also return a full address. Missing data may be `null`, and fields differ between providers. Do not treat a lookup as proof of a user's identity, precise location, or sole authorization signal.

## Validation, quota, and privacy

Private, loopback, reserved, and malformed addresses are rejected inside the platform. They do not call a third-party provider or consume quota. Operations can set daily free quota, instance limits, and overage billing per account; call audits support reconciliation. Query only addresses required by your business and follow applicable data-protection rules.
