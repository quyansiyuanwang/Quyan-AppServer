<template>
  <RouterView></RouterView>
  <AsyncAprilFoolsController v-if="mountAprilFools" />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const AsyncAprilFoolsController = defineAsyncComponent(
  () => import('@/components/easter/AprilFoolsController.vue'),
)
const mountAprilFools = ref(false)

onMounted(() => {
  const enableController = () => {
    mountAprilFools.value = true
  }

  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(enableController, { timeout: 2500 })
    return
  }

  setTimeout(enableController, 1200)
})

onBeforeUnmount(() => {})
</script>
