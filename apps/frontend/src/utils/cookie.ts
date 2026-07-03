/**
 * 获取指定名称的 Cookie 值
 */
export function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) {
    const cookieValue = parts.pop()?.split(';').shift()
    return cookieValue || null
  }
  return null
}

/**
 * 检查指定名称的 Cookie 是否存在
 */
export function hasCookie(name: string): boolean {
  return getCookie(name) !== null
}

/**
 * 等待 Cookie 被设置（带超时）
 * @param cookieName Cookie 名称
 * @param timeoutMs 超时时间（毫秒）
 * @param checkIntervalMs 检查间隔（毫秒）
 * @returns Promise<boolean> - true 表示 Cookie 已设置，false 表示超时
 */
export async function waitForCookie(
  cookieName: string,
  timeoutMs: number = 3000,
  checkIntervalMs: number = 50,
): Promise<boolean> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const checkCookie = () => {
      // 检查 Cookie 是否已设置
      if (hasCookie(cookieName)) {
        console.debug(`[Cookie] ${cookieName} detected after ${Date.now() - startTime}ms`)
        resolve(true)
        return
      }

      // 检查是否超时
      if (Date.now() - startTime >= timeoutMs) {
        console.warn(`[Cookie] ${cookieName} not detected after ${timeoutMs}ms timeout`)
        resolve(false)
        return
      }

      // 继续检查
      setTimeout(checkCookie, checkIntervalMs)
    }

    checkCookie()
  })
}
