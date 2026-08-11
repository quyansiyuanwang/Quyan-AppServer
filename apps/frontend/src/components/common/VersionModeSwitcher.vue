<template>
  <el-menu-item v-if="targetUrl" index="version-mode" class="item-version-mode" @click="switchMode">
    <el-icon><SwitchButton /></el-icon>
    <template #title>{{ i18ns.t('nav.switchToLegacy') }}</template>
  </el-menu-item>
</template>

<script setup lang="ts">
import { SwitchButton } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { resolveCurrentVersionSwitchUrl } from '@/config/version-switch'

const targetUrl = computed(() => resolveCurrentVersionSwitchUrl())

const switchMode = () => {
  if (targetUrl.value) window.location.assign(targetUrl.value)
}
</script>
