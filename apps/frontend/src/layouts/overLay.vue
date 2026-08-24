<template>
  <LayoutWrapper>
    <RouterView v-slot="{ Component, route }">
      <Transition name="page-fade" mode="out-in">
        <div v-if="Component" :key="route.fullPath" class="route-transition-shell">
          <component :is="Component" />
        </div>
      </Transition>
    </RouterView>
  </LayoutWrapper>
</template>

<script setup lang="ts">
import LayoutWrapper from '@/layouts/HomeFrameLayout.vue'
</script>

<style scoped lang="scss">
.theme-switch {
  --el-switch-on-color: #409eff;
}

.route-transition-shell {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  height: 100%;
}

/* Page transition styles */
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 280ms ease,
    transform 280ms ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.page-fade-enter-to,
.page-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>
