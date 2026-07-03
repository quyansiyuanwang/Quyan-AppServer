<template>
  <div class="water-mark-wrapper">
    <el-watermark :font="font" :content="text">
      <div class="water-mark-content" />
    </el-watermark>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'

const { useText } = useWaterMarkTextStore()
const text = useText()

const font = reactive({ color: 'rgba(0, 0, 0)' })

const isDark = useThemeToggleStore().useIsDark()

watch(
  isDark,
  () => (font.color = isDark.value ? 'rgba(255, 255, 255, .01)' : 'rgba(0, 0, 0, .06)'),
  { immediate: true },
)
</script>

<style scoped>
.water-mark-wrapper {
  position: fixed;
  inset: 0;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  display: block;
  z-index: 0;
}

.water-mark-wrapper > * {
  width: 100%;
  height: 100%;
  display: block;
}

.water-mark-content {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
