import { defineAsyncComponent } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, PieChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'

let registered = false

const ensureRegistered = () => {
  if (registered) return
  use([
    CanvasRenderer,
    LineChart,
    PieChart,
    BarChart,
    TitleComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
  ])
  registered = true
}

export const AsyncVChart = defineAsyncComponent(async () => {
  ensureRegistered()
  return VChart
})
