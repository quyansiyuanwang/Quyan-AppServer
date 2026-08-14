<template>
  <LayoutWrapper>
    <RouterView />
  </LayoutWrapper>
  <TopLoadingProgress />
</template>

<script setup lang="ts">
import TopLoadingProgress from '@/components/layout/TopLoadingProgress.vue'
import LayoutWrapper from '@/layouts/HomeFrameLayout.vue'
</script>
