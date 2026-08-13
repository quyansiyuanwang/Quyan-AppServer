import { i18ns } from '@/locales'
import { ElMessageBox } from 'element-plus'

export const extractEntryModule = (html: string): string | undefined => {
  const moduleScript = html.match(/<script\b[^>]*\btype=(["'])module\1[^>]*>/i)?.[0]
  return moduleScript?.match(/\bsrc=(["'])([^"']+)\1/i)?.[2]
}

let initialEntryModule: string | undefined
let pendingEntryModule: string | undefined
let pendingEntryModuleChecks = 0
let isRefreshPromptShown = false

export const configureWatchDog = () => {
  /**
   * 监听服务器前端构建是否更新。只比较入口模块，而不是完整 HTML，
   * 并要求连续两次观察到同一新入口，避免边缘节点短暂不一致时误提示。
   */
  setInterval(() => {
    if (isRefreshPromptShown) return

    fetch('/', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unexpected index response: ${response.status}`)
        return await response.text()
      })
      .then((html) => {
        const currentEntryModule = extractEntryModule(html)
        if (!currentEntryModule) {
          console.warn('[WatchDog] Unable to identify the index entry module')
          return
        }

        if (!initialEntryModule) {
          initialEntryModule = currentEntryModule
          console.info('[WatchDog] Initial entry module set:', initialEntryModule)
          return
        }

        if (currentEntryModule === initialEntryModule) {
          pendingEntryModule = undefined
          pendingEntryModuleChecks = 0
          return
        }

        if (currentEntryModule !== pendingEntryModule) {
          pendingEntryModule = currentEntryModule
          pendingEntryModuleChecks = 1
          return
        }

        pendingEntryModuleChecks += 1
        if (pendingEntryModuleChecks >= 2) {
          console.info('[WatchDog] Detected a stable new entry module, prompting user to refresh')
          isRefreshPromptShown = true

          ElMessageBox.confirm(
            i18ns.t('watchdog.newVersionMessage'),
            i18ns.t('watchdog.newVersionTitle'),
            {
              confirmButtonText: i18ns.t('watchdog.refreshNow'),
              cancelButtonText: i18ns.t('watchdog.refreshLater'),
              type: 'info',
            },
          )
            .then(() => {
              window.location.reload()
            })
            .catch(() => {
              // 用户选择稍后刷新，不做任何操作
            })
        }
      })
      .catch((error) => {
        console.error('[WatchDog] Failed to check index.html:', error)
      })
  }, 5 * 1000)
}
