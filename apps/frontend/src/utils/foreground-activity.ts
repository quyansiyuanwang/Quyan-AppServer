let pending = 0
const listeners = new Set<() => void>()
export const hasForegroundRequests = () => pending > 0
export const onForegroundIdle = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const trackForegroundRequest = async <T>(request: Promise<T>): Promise<T> => {
  pending++
  try {
    return await request
  } finally {
    pending--
    if (pending === 0) listeners.forEach((listener) => listener())
  }
}
