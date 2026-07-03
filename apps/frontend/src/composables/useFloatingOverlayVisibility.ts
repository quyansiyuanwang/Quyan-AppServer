import { computed, ref } from 'vue'

const hiddenCount = ref(0)

const setHidden = (hidden: boolean) => {
  if (hidden) {
    hiddenCount.value += 1
    return
  }

  hiddenCount.value = Math.max(0, hiddenCount.value - 1)
}

const reset = () => {
  hiddenCount.value = 0
}

export const useFloatingOverlayVisibility = () => ({
  isHidden: computed(() => hiddenCount.value > 0),
  setHidden,
  reset,
})
