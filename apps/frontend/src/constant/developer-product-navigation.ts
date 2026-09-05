import type { Component } from 'vue'
import { Bell, Connection, Document, Key, Link, Lock, Monitor } from '@element-plus/icons-vue'
import type { DeveloperProductCode } from '@quyan/shared'
import type { RouteName } from '@/types/route-types.gen'
import { Permission } from '@/constant/permission'

export interface DeveloperProductNavigationItem {
  code: DeveloperProductCode
  urlSlug: string
  labelKey: string
  icon: Component
  permissions: Permission[]
}

export const DEVELOPER_PRODUCT_NAVIGATION: readonly DeveloperProductNavigationItem[] = [
  {
    code: 'kv',
    urlSlug: 'kv',
    labelKey: 'nav.productKv',
    icon: Connection,
    permissions: [
      Permission.PRODUCT_KV_READ,
      Permission.PRODUCT_KV_WRITE,
      Permission.PRODUCT_KV_MANAGE,
    ],
  },
  {
    code: 'short_link',
    urlSlug: 'short-link',
    labelKey: 'nav.productShortLink',
    icon: Link,
    permissions: [
      Permission.PRODUCT_SHORT_LINK_READ,
      Permission.PRODUCT_SHORT_LINK_WRITE,
      Permission.PRODUCT_SHORT_LINK_MANAGE,
    ],
  },
  {
    code: 'secret',
    urlSlug: 'secret',
    labelKey: 'nav.productSecret',
    icon: Lock,
    permissions: [
      Permission.PRODUCT_SECRET_READ,
      Permission.PRODUCT_SECRET_WRITE,
      Permission.PRODUCT_SECRET_USE,
      Permission.PRODUCT_SECRET_MANAGE,
    ],
  },
  {
    code: 'status',
    urlSlug: 'status',
    labelKey: 'nav.productStatus',
    icon: Monitor,
    permissions: [
      Permission.PRODUCT_STATUS_READ,
      Permission.PRODUCT_STATUS_WRITE,
      Permission.PRODUCT_STATUS_PUBLISH,
      Permission.PRODUCT_STATUS_MANAGE,
    ],
  },
  {
    code: 'verification',
    urlSlug: 'verification',
    labelKey: 'nav.productVerification',
    icon: Key,
    permissions: [
      Permission.PRODUCT_VERIFICATION_SEND,
      Permission.PRODUCT_VERIFICATION_VERIFY,
      Permission.PRODUCT_VERIFICATION_MANAGE,
    ],
  },
  {
    code: 'ip_geolocation',
    urlSlug: 'ip-geolocation',
    labelKey: 'nav.productIpGeolocation',
    icon: Connection,
    permissions: [
      Permission.PRODUCT_IP_GEOLOCATION_LOOKUP,
      Permission.PRODUCT_IP_GEOLOCATION_MANAGE,
    ],
  },
  {
    code: 'push',
    urlSlug: 'push',
    labelKey: 'nav.productPush',
    icon: Bell,
    permissions: [
      Permission.PRODUCT_PUSH_SEND,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      Permission.PRODUCT_PUSH_DELIVERY_READ,
      Permission.PRODUCT_PUSH_MANAGE,
    ],
  },
  {
    code: 'json_endpoint',
    urlSlug: 'json-endpoints',
    labelKey: 'nav.productJsonEndpoints',
    icon: Document,
    permissions: [
      Permission.PRODUCT_JSON_ENDPOINT_READ,
      Permission.PRODUCT_JSON_ENDPOINT_WRITE,
      Permission.PRODUCT_JSON_ENDPOINT_MANAGE,
    ],
  },
]

export const developerProductUserRoute = (product: DeveloperProductCode): RouteName =>
  `product-${product}` as RouteName

export const developerProductManagementRoute = (product: DeveloperProductCode): RouteName =>
  `product-management-${product}` as RouteName

export const developerProductConfigRoute = (product: DeveloperProductCode): RouteName =>
  `product-config-${product}` as RouteName

export const developerProductUrlSlug = (product: DeveloperProductCode): string =>
  DEVELOPER_PRODUCT_NAVIGATION.find((item) => item.code === product)?.urlSlug || product
