import { computed, ref } from 'vue'
import { OAuthClientService } from '@/service/oauthClientService'
import type { OAuthScopeCatalogItemDto } from '@/client/types.gen'
import { getErrorMessage } from '@/utils/error-utils'
import { i18ns } from '@/locales'

export const useOAuthScopeCatalog = () => {
  const service = OAuthClientService.getInstance()
  const scopeCatalog = ref<OAuthScopeCatalogItemDto[]>([])
  const scopeCatalogLoading = ref(false)
  const scopeCatalogError = ref('')
  const scopeCatalogLoaded = ref(false)
  let pending: Promise<void> | undefined

  const loadScopeCatalog = (): Promise<void> => {
    if (pending) return pending
    scopeCatalogLoading.value = true
    scopeCatalogLoaded.value = false
    scopeCatalogError.value = ''
    pending = (async () => {
      try {
        const response = await service.getOAuthScopes()
        if (!Array.isArray(response?.scopes)) throw new Error('Invalid scope catalog response')
        scopeCatalog.value = response.scopes
        scopeCatalogLoaded.value = true
      } catch (error) {
        scopeCatalog.value = []
        scopeCatalogError.value = getErrorMessage(error, i18ns.t('oauthScopes.loadFailed'))
      } finally {
        scopeCatalogLoading.value = false
        pending = undefined
      }
    })()
    return pending
  }

  return {
    scopeCatalog,
    scopeCatalogLoading,
    scopeCatalogError,
    scopeCatalogReady: computed(
      () => scopeCatalogLoaded.value && !scopeCatalogLoading.value && !scopeCatalogError.value,
    ),
    loadScopeCatalog,
  }
}
