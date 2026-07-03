<template>
  <transition name="top-progress-fade">
    <div v-if="visible" class="top-progress-wrapper">
      <el-progress :percentage="progress" :show-text="false" :stroke-width="3" />
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'
import { authEventBus, customCodeBus } from '@/stores/globalInstance'

const topLoadingProgressStore = useTopLoadingProgressStore()

const progress = computed(() => Math.max(0, topLoadingProgressStore.progress))
const visible = computed(() => topLoadingProgressStore.isVisible)

// 自动清理进度条的事件处理器
const handleCleanup = () => {
  topLoadingProgressStore.reset()
}

onMounted(() => {
  // 监听需要清理进度条的事件
  authEventBus.on('USER_LOGGED_OUT', handleCleanup)
  authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', handleCleanup)
  customCodeBus.on('TOKEN_EXPIRED_DUE_TO_UPDATE', handleCleanup)
})

onBeforeUnmount(() => {
  // 清理事件监听
  authEventBus.off('USER_LOGGED_OUT', handleCleanup)
  authEventBus.off('ACCESS_TOKEN_REFRESH_FAILED', handleCleanup)
  customCodeBus.off('TOKEN_EXPIRED_DUE_TO_UPDATE', handleCleanup)
})
</script>

<style scoped>
.top-progress-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  padding: 0;
  margin: 0;
  z-index: 2200;
  pointer-events: none;
  background: transparent;
}

:deep(.el-progress-bar__outer) {
  background-color: transparent;
}

:deep(.el-progress) {
  margin: 0;
}

:global(.top-progress-fade-enter-active),
:global(.top-progress-fade-leave-active) {
  transition: opacity 0.2s ease;
}

:global(.top-progress-fade-enter-from),
:global(.top-progress-fade-leave-to) {
  opacity: 0;
}
</style>
