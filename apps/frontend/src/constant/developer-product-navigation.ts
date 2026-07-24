import type { Component } from 'vue'
import { Bell, Connection, Key, Link, Lock, Monitor } from '@element-plus/icons-vue'
import type { DeveloperProductCode } from '@appserver/shared'
import type { RouteName } from '@/types/route-types.gen'

export interface DeveloperProductNavigationItem {
  code: DeveloperProductCode
  labelKey: string
  icon: Component
}

export const DEVELOPER_PRODUCT_NAVIGATION: readonly DeveloperProductNavigationItem[] = [
  { code: 'kv', labelKey: 'nav.productKv', icon: Connection },
  { code: 'short_link', labelKey: 'nav.productShortLink', icon: Link },
  { code: 'secret', labelKey: 'nav.productSecret', icon: Lock },
  { code: 'status', labelKey: 'nav.productStatus', icon: Monitor },
  { code: 'verification', labelKey: 'nav.productVerification', icon: Key },
  { code: 'ip_geolocation', labelKey: 'nav.productIpGeolocation', icon: Connection },
  { code: 'push', labelKey: 'nav.productPush', icon: Bell },
]

export const developerProductUserRoute = (product: DeveloperProductCode): RouteName =>
  `product-${product}` as RouteName

export const developerProductManagementRoute = (product: DeveloperProductCode): RouteName =>
  `product-management-${product}` as RouteName

export const developerProductConfigRoute = (product: DeveloperProductCode): RouteName =>
  `product-config-${product}` as RouteName
