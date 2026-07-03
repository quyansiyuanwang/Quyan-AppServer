import { ElNotification } from 'element-plus'

export type NotificationType = 'success' | 'error' | 'info' | 'warning'
export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

type NotificationOptions = {
  title: string
  message: string
  type: NotificationType
  duration?: number
  isHtml?: boolean
  icon?: string
  zIndex?: number
  offset?: number
  position?: Position
  onClose?: () => void
  onClick?: () => void
}
type ListenerType = (options: NotificationOptions) => any
type ElNotificationType = ReturnType<typeof ElNotification>

// ========== shorted type alias ==========
type NT = NotificationType
// type P = Position
type NO = NotificationOptions
type L = ListenerType
type ElType = ElNotificationType

let sanitizeHtmlPromise: Promise<typeof import('./asyncMarkdown').sanitizeHtml> | null = null

const sanitizeHtml = async (html: string): Promise<string> => {
  sanitizeHtmlPromise ??= import('./asyncMarkdown').then((module) => module.sanitizeHtml)
  const sanitizer = await sanitizeHtmlPromise
  return sanitizer(html)
}

export class Notification {
  private static instances: Notification[] = []
  private static listeners: L[] = []
  private static ElNotifications: ElType[] = []
  private static pending = new Map<string, ReturnType<typeof setTimeout>>()
  private static active = new Map<string, ElType>()
  private static bumpTime = new Map<string, number>()
  private static DEBOUNCE_MS = 50
  private static BUMP_COOLDOWN_MS = 100

  private options: NO
  private defaultOptions: NO = {
    title: '',
    message: '',
    type: 'info',
    duration: 3000,
    isHtml: false,
    icon: undefined,
    zIndex: 2000,
    offset: 0,
    position: 'top-right',
    onClose: () => {},
    onClick: () => {},
  }
  private instance: ElType | null = null

  constructor(options?: NO) {
    this.options = options || this.defaultOptions
  }

  getOptions = () => this.options

  show = () => {
    const key = `${this.options.type}:${this.options.title}:${this.options.message}`

    const activeInst = Notification.active.get(key)
    if (activeInst) {
      const lastBump = Notification.bumpTime.get(key) ?? 0
      if (Date.now() - lastBump < Notification.BUMP_COOLDOWN_MS) return this
      Notification.bumpTime.set(key, Date.now())
      Notification.active.delete(key)
      activeInst.close()
      void this._doShow(key)
      return this
    }

    // Debounce simultaneous programmatic calls
    const t = Notification.pending.get(key)
    if (t) clearTimeout(t)
    Notification.pending.set(
      key,
      setTimeout(() => {
        Notification.pending.delete(key)
        void this._doShow(key)
      }, Notification.DEBOUNCE_MS),
    )
    return this
  }

  private _doShow = async (key: string) => {
    const origClose = this.options.onClose
    this.options.onClose = () => {
      if (Notification.active.get(key) === this.instance) {
        Notification.active.delete(key)
        Notification.bumpTime.delete(key)
      }
      origClose?.()
    }
    const safeMessage = this.options.isHtml
      ? await sanitizeHtml(this.options.message)
      : this.options.message

    this.instance = ElNotification({
      ...this.options,
      message: safeMessage,
      dangerouslyUseHTMLString: this.options.isHtml,
    })
    Notification.active.set(key, this.instance)
    Notification.ElNotifications.push(this.instance)
    Notification.listeners.forEach((l) => l(this.options))
  }

  addNotification = () => {
    Notification.instances.push(this)
    return this
  }

  quickClose = (timeout?: number) => {
    setTimeout(() => {
      this.instance?.close()
    }, timeout || 0)
    return this
  }

  close = () => {
    this.instance?.close()
    return this
  }

  static notify = (title: string, message: string, type: NT) =>
    new Notification({ title, message, type }).show()
}
