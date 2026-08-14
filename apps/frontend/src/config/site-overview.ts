import type { SiteProfileId } from '@/config/site-registry'

/** Profiles rendered by the shared, data-bearing site overview view. */
export const siteOverviewMetricProfileIds = [
  'public',
  'identity',
  'account',
  'chat',
  'console-ai',
  'console-developer',
  'console-ram',
  'product-kv',
  'product-short_link',
  'product-secret',
  'product-status',
  'product-verification',
  'product-ip_geolocation',
  'product-push',
  'product-oj',
  'management-core',
  'management-ai',
  'management-developer',
  'management-terminal',
] as const satisfies readonly SiteProfileId[]
