<template>
  <slot />
  <div v-if="$slots['top-left']" class="overlay-item top-left" :style="overlayStyle">
    <slot name="top-left" />
  </div>
  <div v-if="$slots['top-right']" class="overlay-item top-right" :style="overlayStyle">
    <slot name="top-right" />
  </div>
  <div v-if="$slots['bottom-left']" class="overlay-item bottom-left" :style="overlayStyle">
    <slot name="bottom-left" />
  </div>
</template>

<script setup lang="ts">
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { computed, onBeforeUnmount, ref } from 'vue'
import localStorageKeys from '@/constant/storagekey'

type OverlayPosition = {
  left: number
  top: number
}

type OverlayPositionMap = {
  'bottom-right'?: OverlayPosition
}

const props = withDefaults(
  defineProps<{
    zIndex?: number
    target?: string
  }>(),
  {
    zIndex: 2100,
    target: 'body',
  },
)

const bottomRightRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const shouldSuppressClick = ref(false)
const activePointerId = ref<number | null>(null)
const pointerStartX = ref(0)
const pointerStartY = ref(0)
const pointerOffsetX = ref(0)
const pointerOffsetY = ref(0)
const positions = ref<OverlayPositionMap>(loadSavedPositions())

const overlayStyle = computed(() => ({
  zIndex: props.zIndex,
}))

function loadSavedPositions(): OverlayPositionMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const rawValue = TypedLocalStorage.getItem(localStorageKeys.Overlay.FLOATING_PANEL_POSITION)
    if (!rawValue) {
      return {}
    }

    const parsedValue = JSON.parse(rawValue) as OverlayPositionMap
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {}
  } catch {
    return {}
  }
}

function savePositions() {
  if (typeof window === 'undefined') {
    return
  }

  if (!positions.value['bottom-right']) {
    TypedLocalStorage.removeItem(localStorageKeys.Overlay.FLOATING_PANEL_POSITION)
    return
  }

  TypedLocalStorage.setItem(
    localStorageKeys.Overlay.FLOATING_PANEL_POSITION,
    JSON.stringify(positions.value),
  )
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const releaseDrag = () => {
  isDragging.value = false
  activePointerId.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

const onPointerMove = (event: PointerEvent) => {
  if (activePointerId.value !== event.pointerId || !bottomRightRef.value) {
    return
  }

  if (!shouldSuppressClick.value) {
    const movedX = Math.abs(event.clientX - pointerStartX.value)
    const movedY = Math.abs(event.clientY - pointerStartY.value)

    if (movedX <= 4 && movedY <= 4) {
      return
    }

    shouldSuppressClick.value = true
    isDragging.value = true

    if (!bottomRightRef.value.hasPointerCapture(event.pointerId)) {
      bottomRightRef.value.setPointerCapture(event.pointerId)
    }
  }

  const maxLeft = Math.max(window.innerWidth - bottomRightRef.value.offsetWidth, 0)
  const maxTop = Math.max(window.innerHeight - bottomRightRef.value.offsetHeight, 0)
  const nextLeft = clamp(event.clientX - pointerOffsetX.value, 0, maxLeft)
  const nextTop = clamp(event.clientY - pointerOffsetY.value, 0, maxTop)

  positions.value = {
    ...positions.value,
    'bottom-right': {
      left: nextLeft,
      top: nextTop,
    },
  }
}

const onPointerUp = (event: PointerEvent) => {
  if (activePointerId.value !== event.pointerId) {
    return
  }

  if (bottomRightRef.value?.hasPointerCapture(event.pointerId)) {
    bottomRightRef.value.releasePointerCapture(event.pointerId)
  }

  const shouldSavePosition = shouldSuppressClick.value
  releaseDrag()
  if (shouldSavePosition) {
    savePositions()
  }
}

onBeforeUnmount(() => {
  releaseDrag()
})
</script>

<style scoped>
.overlay-item {
  position: fixed;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.overlay-item.top-left {
  top: 24px;
  left: 24px;
}

.overlay-item.top-right {
  top: 24px;
  right: 24px;
}

.overlay-item.bottom-left {
  bottom: 24px;
  left: 24px;
}

.overlay-item.bottom-right {
  bottom: 24px;
  right: 24px;
  flex-direction: row;
  gap: 12px;
}

.overlay-item.is-draggable {
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.overlay-item.is-draggable.is-dragging {
  cursor: grabbing;
}

.overlay-reset-button {
  flex: 0 0 auto;
}

@media screen and (max-width: 768px) {
  .overlay-item.bottom-left,
  .overlay-item.bottom-right {
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
}
</style>
