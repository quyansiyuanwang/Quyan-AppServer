<script setup lang="ts">
import { computed } from 'vue'
import type { CarpoolOrderState } from '@/client/types.gen'
import { i18ns } from '@/locales'

const props = defineProps<{ state: CarpoolOrderState | string }>()
const label = computed(
  () =>
    ({
      open: i18ns.t('carpool.state.open'),
      submitted: i18ns.t('carpool.state.submitted'),
      accepted: i18ns.t('carpool.state.accepted'),
      fulfilled: i18ns.t('carpool.state.fulfilled'),
      failed: i18ns.t('carpool.state.failed'),
      cancelled: i18ns.t('carpool.state.cancelled'),
      expired: i18ns.t('carpool.state.expired'),
    })[props.state] ?? props.state,
)
const type = computed(() => {
  const types: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    open: 'primary',
    submitted: 'warning',
    accepted: 'warning',
    fulfilled: 'success',
    failed: 'danger',
    cancelled: 'info',
    expired: 'info',
  }
  return types[props.state] ?? 'info'
})
</script>

<template>
  <el-tag :type="type" effect="light">{{ label }}</el-tag>
</template>
