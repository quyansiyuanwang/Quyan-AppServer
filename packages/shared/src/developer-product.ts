export const DEVELOPER_PRODUCT_CODES = [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
] as const

export type DeveloperProductCode = (typeof DEVELOPER_PRODUCT_CODES)[number]

export interface DeveloperProductDefinition {
  code: DeveloperProductCode
  urlSlug: string
  name: string
  apiPath?: string
  supportsExternalApi: boolean
}

export const DEVELOPER_PRODUCTS: readonly DeveloperProductDefinition[] = [
  { code: 'kv', urlSlug: 'kv', name: 'KV Storage', apiPath: '/v1/products/kv', supportsExternalApi: true },
  { code: 'short_link', urlSlug: 'short-link', name: 'Short Links', supportsExternalApi: false },
  { code: 'secret', urlSlug: 'secret', name: 'Secret Vault', supportsExternalApi: false },
  { code: 'status', urlSlug: 'status', name: 'Status Monitoring', supportsExternalApi: false },
  {
    code: 'verification',
    urlSlug: 'verification',
    name: 'Verification API',
    apiPath: '/v1/products/verification',
    supportsExternalApi: true,
  },
  {
    code: 'ip_geolocation',
    urlSlug: 'ip-geolocation',
    name: 'IP Geolocation',
    apiPath: '/v1/products/ip-geolocation',
    supportsExternalApi: true,
  },
  {
    code: 'push',
    urlSlug: 'push',
    name: 'Push Aggregation',
    apiPath: '/v1/products/push',
    supportsExternalApi: true,
  },
]

export function isDeveloperProductCode(value: string): value is DeveloperProductCode {
  return (DEVELOPER_PRODUCT_CODES as readonly string[]).includes(value)
}
