import { ElMessage } from 'element-plus'

type MsgType = 'success' | 'error' | 'warning' | 'info'

const DEBOUNCE_MS = 50
const BUMP_COOLDOWN_MS = 100
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const active = new Map<string, { close: () => void }>()
const bumpTime = new Map<string, number>()

function doShow(type: MsgType, msg: string, key: string) {
  const inst = ElMessage({
    type,
    message: msg,
    onClose: () => {
      if (active.get(key) === inst) {
        active.delete(key)
        bumpTime.delete(key)
      }
    },
  })
  active.set(key, inst)
}

function deduped(type: MsgType, msg: string) {
  const key = `${type}:${msg}`

  const activeInst = active.get(key)
  if (activeInst) {
    const lastBump = bumpTime.get(key) ?? 0
    if (Date.now() - lastBump < BUMP_COOLDOWN_MS) return
    bumpTime.set(key, Date.now())
    active.delete(key)
    activeInst.close()
    doShow(type, msg, key)
    return
  }

  const t = pending.get(key)
  if (t) clearTimeout(t)
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key)
      doShow(type, msg, key)
    }, DEBOUNCE_MS),
  )
}

export const message = {
  success: (msg: string) => deduped('success', msg),
  error: (msg: string) => deduped('error', msg),
  warning: (msg: string) => deduped('warning', msg),
  info: (msg: string) => deduped('info', msg),
}
