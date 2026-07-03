<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :style="{ color }"
    aria-hidden="true"
  >
    <path d="M10 17v-3h7v-4h-7V7l-5 5 5 5z" fill="currentColor" />
    <path d="M20 3H12v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" fill="currentColor" />
  </svg>
</template>

<script setup lang="ts">
const props = defineProps({
  size: {
    type: [Number, String],
    default: 20,
  },
  color: {
    type: String,
    default: 'currentColor',
  },
})

const { size, color } = props as { size: number | string; color: string }
</script>
