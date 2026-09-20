<template>
  <div class="holiday-rule-fields">
    <label class="holiday-rule-fields__label">{{ i18ns.t('relay.holidayMode') }}</label>
    <el-select v-model="holidayMode" :aria-label="i18ns.t('relay.holidayMode')">
      <el-option
        v-for="mode in modes"
        :key="mode"
        :value="mode"
        :label="i18ns.t(`relay.holidayMode_${mode}`)"
      />
    </el-select>
    <el-checkbox v-model="allDay">{{ i18ns.t('relay.timeRuleAllDay') }}</el-checkbox>
    <div class="holiday-rule-fields__help">{{ i18ns.t('relay.holidayModeHelp') }}</div>
  </div>
</template>

<script setup lang="ts">
import type { TimePeriodMultiplierRule } from '@/client/types.gen'
import { i18ns } from '@/locales'

const modes = ['ignore', 'exclude', 'only'] as const satisfies readonly NonNullable<
  TimePeriodMultiplierRule['holidayMode']
>[]
const holidayMode = defineModel<TimePeriodMultiplierRule['holidayMode']>('holidayMode', {
  default: 'ignore',
})
const allDay = defineModel<boolean>('allDay', { default: false })
</script>

<style scoped>
.holiday-rule-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  grid-column: 1 / -1;
  width: 100%;
}
.holiday-rule-fields :deep(.el-select) {
  width: 180px;
}
.holiday-rule-fields__label {
  font-size: 14px;
}
.holiday-rule-fields__help {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
