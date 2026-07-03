import '@/assets/main.css'
import '@/assets/tailwind.css'
import '@/assets/april-fools.css'

// Element Plus component styles are injected during build by unplugin-element-plus.
import 'element-plus/theme-chalk/dark/css-vars.css'

export { bootstrapApp as bootstrap } from '@/bootstrap'
import { bootstrapApp } from '@/bootstrap'

if (import.meta.env.MODE !== 'test') {
  void bootstrapApp()
}
