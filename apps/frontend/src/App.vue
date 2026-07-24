<template>
  <RouterView></RouterView>
  <AsyncAprilFoolsController v-if="mountAprilFools && !isPublicStatus" />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const AsyncAprilFoolsController = defineAsyncComponent(
  () => import('@/components/easter/AprilFoolsController.vue'),
)
const mountAprilFools = ref(false)
const route = useRoute()
const isPublicStatus = computed(() => route.meta.publicStatus === true)

onMounted(() => {
  if (import.meta.env.VITE_APRIL_FOOL_ENABLED !== 'true') return

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
</script>
