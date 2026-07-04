import { debounce } from '@/utils/debounce'
import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import { windowEventBus } from '@/stores/globalInstance'

export const useIsDesktopStore = defineStore('isDesktop', () => {
  const getViewportWidth = () => {
    const documentWidth = document.documentElement?.clientWidth
    if (typeof documentWidth === 'number' && Number.isFinite(documentWidth) && documentWidth > 0) {
      return documentWidth
    }

    return window.innerWidth
  }

  const isDesktop = ref(getViewportWidth() > 768)

  const updateIsDesktop = debounce(() => {
    isDesktop.value = getViewportWidth() > 768
    nextTick(() => {
      windowEventBus.emit('RESIZE', isDesktop.value)
    })
  }, 100)

  window.addEventListener('resize', updateIsDesktop)
  window.addEventListener('orientationchange', updateIsDesktop)

  const desktopMediaQuery = window.matchMedia('(min-width: 769px)')
  desktopMediaQuery.addEventListener?.('change', updateIsDesktop)

  if (typeof ResizeObserver !== 'undefined') {
    const viewportResizeObserver = new ResizeObserver(() => {
      updateIsDesktop()
    })

    viewportResizeObserver.observe(document.documentElement)
  }

  const useIsDesktop = () => isDesktop

  return {
    useIsDesktop,
  }
})
