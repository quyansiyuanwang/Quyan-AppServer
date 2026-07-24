# IP Geolocation

IP Geolocation normalizes a public IP into country, region, city, ASN, carrier, and data-source fields. It is suitable for regional presentation, risk signals, and content localization. Results come from a configured provider and use a short-lived cache to reduce latency and provider traffic.

## API

The IP lookup action is required:

```http
GET /v1/products/ip-geolocation/8.8.8.8
Authorization: Bearer dpk_...
```

The response supplies country, region, city, ASN, carrier, and data source where the provider has data. Do not treat a lookup as proof of a user's identity, precise location, or sole authorization signal.

## Validation, quota, and privacy

Private, loopback, reserved, and malformed addresses are rejected inside the platform. They do not call a third-party provider or consume quota. Operations can set daily free quota, instance limits, and overage billing per account; call audits support reconciliation. Query only addresses required by your business and follow applicable data-protection rules.
