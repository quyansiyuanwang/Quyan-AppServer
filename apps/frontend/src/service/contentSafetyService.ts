import { createContentSafetyControllerApi } from '@/client/services/content-safety-controller.gen'
import { useRequestStore } from '@/stores/request'

export const contentSafetyService = {
  getApi() {
    return createContentSafetyControllerApi(useRequestStore().getAxios())
  },
}
