import { createSupportControllerApi } from '@/client/services/support-controller.gen'
import { useRequestStore } from '@/stores/request'

export const supportService = {
  getApi() {
    return createSupportControllerApi(useRequestStore().getAxios())
  },
}
