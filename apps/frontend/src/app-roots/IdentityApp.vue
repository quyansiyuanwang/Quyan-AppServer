<template>
  <RouterView />
  <TwoFactorOverlayHost />
  <TopLoadingProgress />
</template>

<script setup lang="ts">
import TopLoadingProgress from '@/components/layout/TopLoadingProgress.vue'
import TwoFactorOverlayHost from '@/components/auth/TwoFactorOverlayHost.vue'
</script>
