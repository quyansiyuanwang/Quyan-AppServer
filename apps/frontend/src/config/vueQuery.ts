/**
 * Vue Query (TanStack Query) 配置
 * 提供请求管理、缓存、自动重试、loading状态等功能
 */

import { VueQueryPlugin, type VueQueryPluginOptions } from '@tanstack/vue-query'
import type { App } from 'vue'

/**
 * Vue Query 配置选项
 */
export const vueQueryOptions: VueQueryPluginOptions = {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        // 数据过期时间（5分钟）
        staleTime: 5 * 60 * 1000,
        // 缓存时间（10分钟）
        gcTime: 10 * 60 * 1000,
        // 失败后重试次数
        retry: 3,
        // 重试延迟（指数退避）
        retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
        // 窗口重新获得焦点时重新获取
        refetchOnWindowFocus: false,
        // 网络重新连接时重新获取
        refetchOnReconnect: true,
        // 组件挂载时不自动重新获取（避免不必要的请求）
        refetchOnMount: false,
      },
      mutations: {
        // mutation 失败后重试次数
        retry: 1,
      },
    },
  },
}

/**
 * 安装 Vue Query 插件
 */
export function setupVueQuery(app: App) {
  app.use(VueQueryPlugin, vueQueryOptions)
}
