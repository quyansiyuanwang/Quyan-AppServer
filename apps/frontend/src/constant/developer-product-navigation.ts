import type { Component } from 'vue'
import { resolveNavigationIcon } from '@/config/navigation-icons'
import {
  DEVELOPER_PRODUCT_NAVIGATION as metadata,
  type DeveloperProductNavigationItem as MetadataItem,
} from './developer-product-metadata'
export {
  developerProductUserRoute,
  developerProductManagementRoute,
  developerProductConfigRoute,
  developerProductUrlSlug,
} from './developer-product-metadata'
export type DeveloperProductNavigationItem = Omit<MetadataItem, 'icon'> & { icon: Component }
export const DEVELOPER_PRODUCT_NAVIGATION: readonly DeveloperProductNavigationItem[] = metadata.map(
  (item) => ({ ...item, icon: resolveNavigationIcon(item.icon) }),
)
