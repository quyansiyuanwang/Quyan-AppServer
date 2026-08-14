export { appRuntime, AppRuntime } from '@/app-runtime'
export const bootstrapApp = () =>
  import('@/app-runtime').then(({ appRuntime }) => appRuntime.start())
