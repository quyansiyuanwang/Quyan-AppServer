<template>
  <transition name="top-progress-fade">
    <div
      v-if="visible"
      class="top-progress-wrapper"
      role="progressbar"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="top-progress-bar" :style="{ transform: `scaleX(${progress / 100})` }" />
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'

const topLoadingProgressStore = useTopLoadingProgressStore()

const progress = computed(() => Math.max(0, topLoadingProgressStore.progress))
const visible = computed(() => topLoadingProgressStore.isVisible)
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

.top-progress-bar {
  width: 100%;
  height: 3px;
  transform-origin: left center;
  background: var(--el-color-primary);
  transition: transform 120ms linear;
  will-change: transform;
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
