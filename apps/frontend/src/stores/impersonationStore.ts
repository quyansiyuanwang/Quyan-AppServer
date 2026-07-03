import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import StorageKey from '@/constant/storagekey'

export interface ImpersonationSessionInfo {
  targetUserId: string
  targetUsername: string
  targetName: string | null
  mode: 'view' | 'act'
  startedAt: number
}

export const useImpersonationStore = defineStore('impersonation', () => {
  const sessionInfo = ref<ImpersonationSessionInfo | null>(null)

  const isImpersonating = computed(() => sessionInfo.value !== null)
  const isViewOnly = computed(() => sessionInfo.value?.mode === 'view')

  const hydrate = () => {
    try {
      const raw = localStorage.getItem(StorageKey.Impersonation.SESSION_INFO)
      if (raw) {
        sessionInfo.value = JSON.parse(raw) as ImpersonationSessionInfo
      }
    } catch {
      sessionInfo.value = null
    }
  }

  const setSession = (info: ImpersonationSessionInfo) => {
    sessionInfo.value = info
    localStorage.setItem(StorageKey.Impersonation.SESSION_INFO, JSON.stringify(info))
  }

  const clearSession = () => {
    sessionInfo.value = null
    localStorage.removeItem(StorageKey.Impersonation.SESSION_INFO)
  }

  return {
    sessionInfo,
    isImpersonating,
    isViewOnly,
    hydrate,
    setSession,
    clearSession,
  }
})
