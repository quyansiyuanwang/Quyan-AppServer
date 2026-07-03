<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed, type Component } from 'vue'

interface Props {
  name: Component
  size?: number | string
  color?: string
  strokeWidth?: number
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  strokeWidth: 2,
})

const sizeValue = computed(() => {
  return typeof props.size === 'number' ? `${props.size}px` : props.size
})
</script>

<template>
  <component :is="name" :size="sizeValue" :color="color" :stroke-width="strokeWidth" class="icon" />
</template>

<style scoped>
.icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
