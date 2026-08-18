/**
 * Compatibility entry point for the existing route table. New routes should
 * use `lazyRouteView` directly; this re-export keeps the migration mechanical
 * while ensuring every view is resolved through the domain manifest.
 */
export {
  bindRouteView,
  lazyFeatureView,
  lazyOptionalView,
  lazyRouteView,
} from './domain-view-loader'
