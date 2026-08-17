import { defineAsyncComponent } from 'vue'

let chartRuntimePromise: Promise<typeof import('./chart-runtime')> | null = null

const loadChartRuntime = () => (chartRuntimePromise ??= import('./chart-runtime'))

// Keep ECharts out of the app shell. `chart-runtime` and its third-party
// dependencies are intentionally emitted as the single async `charts` chunk.
export const AsyncVChart = defineAsyncComponent(async () => (await loadChartRuntime()).getVChart())
