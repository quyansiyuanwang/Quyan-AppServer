<script setup lang="ts">
import { ref } from 'vue'
import SlidingPuzzleBoard from '@/components/SlidingPuzzleBoard.vue'
import SwapPuzzleBoard from '@/components/SwapPuzzleBoard.vue'
const mode = ref<'sliding' | 'swap'>('sliding')
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">拼图</h2>
    <p class="page-description">选择模式：滑动拼图 或 普通拼图（交换拼块）。</p>
    <div style="display: flex; gap: 0.6rem; margin: 0.6rem 0; justify-content: center">
      <button :class="{ active: mode === 'sliding' }" @click="mode = 'sliding'">滑动拼图</button>
      <button :class="{ active: mode === 'swap' }" @click="mode = 'swap'">普通拼图</button>
    </div>
    <div>
      <SlidingPuzzleBoard v-if="mode === 'sliding'" />
      <SwapPuzzleBoard v-else />
    </div>
  </section>
</template>

<style scoped>
button {
  padding: 0.45rem 0.8rem;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: #fff;
}
button.active {
  background: #3b82f6;
  color: #fff;
  border-color: rgba(0, 0, 0, 0.08);
}
</style>
