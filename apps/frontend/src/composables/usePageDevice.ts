import { computed } from 'vue'
import { useIsDesktopStore } from '@/stores/isDesktopStore'

export function usePageDevice() {
  const isDesktopStore = useIsDesktopStore()
  const isDesktop = isDesktopStore.useIsDesktop()
  const isMobile = computed(() => !isDesktop.value)

  return {
    isDesktop,
    isMobile,
  }
}
