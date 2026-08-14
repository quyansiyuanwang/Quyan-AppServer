import type { FeatureModuleRuntime } from '@/plugins/modules/contracts'

/**
 * Transitional runtime for existing route components. Actual views remain
 * route-level async imports, so their services and heavy dependencies are not
 * evaluated until the matching route is rendered.
 */
const runtime: FeatureModuleRuntime = {}

export default runtime
