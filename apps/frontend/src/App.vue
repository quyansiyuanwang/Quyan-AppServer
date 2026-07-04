<template>
  <RouterView></RouterView>
  <AsyncAprilFoolsController v-if="mountAprilFools" />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import router from '@/router'
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { preloadAllRoutes } from '@/utils/routePreloader'

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

// 页面预加载：首屏渲染完成后，在空闲时预加载所有懒加载路由组件
router.isReady().then(() => {
  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(preloadAllRoutes, { timeout: 3000 })
  } else {
    setTimeout(preloadAllRoutes, 1500)
  }
})

onBeforeUnmount(() => {})
</script>
