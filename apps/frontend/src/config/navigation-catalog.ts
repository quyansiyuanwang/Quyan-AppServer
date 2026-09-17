import { resolveNavigationIcon } from './navigation-icons'
import type { Component } from 'vue'
import {
  navigationMenuDefinition as metadata,
  debugNavigationNode as debugMetadata,
  type NavigationNode as MetadataNode,
  type NavigationRouteEntry as MetadataRouteEntry,
} from './navigation-metadata'
export {
  overviewRouteByProfile,
  isNavigationNodeAllowed,
  filterNavigationNodes,
  flattenNavigationRoutes,
  collectVisibleNavigationRoutes,
} from './navigation-metadata'
export type NavigationNode = MetadataNode<Component>
export type NavigationRouteEntry = MetadataRouteEntry<Component>
const withIcons = (node: MetadataNode): NavigationNode => ({
  ...node,
  icon: resolveNavigationIcon(node.icon),
  children: node.children?.map(withIcons),
})
export const navigationMenuDefinition: readonly NavigationNode[] = metadata.map(withIcons)
export const debugNavigationNode = withIcons(debugMetadata)
