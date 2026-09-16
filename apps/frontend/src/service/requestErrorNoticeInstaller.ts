import { Notification } from '@/utils/notification'
import { configureRequestErrorNotifier } from '@/utils/requestErrorNotice'

export const installRequestErrorNotifier = (): void => {
  configureRequestErrorNotifier((title, message) => {
    Notification.notify(title, message, 'error')
  })
}
