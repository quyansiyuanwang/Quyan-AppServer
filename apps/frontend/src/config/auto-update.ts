import { i18ns } from '@/locales'
import { ElMessageBox } from 'element-plus'

/**
 * 计算字符串的简单哈希值
 */
const simpleHash = (str: string): string => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

let isInitialHashSet = false
let initialIndexHash: string | null = null
let isRefreshPromptShown = false

export const configureWatchDog = () => {
  /**
   * 监听服务器前端页面是否更新
   * 通过定期请求 index.html 并比较内容哈希值来检测更新
   */
  setInterval(() => {
    if (isInitialHashSet && (!initialIndexHash || isRefreshPromptShown)) return

    fetch('/', { cache: 'no-cache' })
      .then((response) => response.text())
      .then((html) => {
        const currentHash = simpleHash(html)

        if (!isInitialHashSet) {
          initialIndexHash = currentHash
          isInitialHashSet = true
          console.info('[WatchDog] Initial index.html hash set:', initialIndexHash)
          return
        }

        if (currentHash !== initialIndexHash) {
          console.info('[WatchDog] Detected index.html change, prompting user to refresh')
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
