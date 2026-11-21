<template>
  <el-form label-position="top" class="overdraft-rule">
    <el-form-item :label="t('overdraft.mode')">
      <el-select :model-value="modelValue.mode" @update:model-value="update('mode', $event)">
        <el-option
          v-for="mode in BALANCE_OVERDRAFT_MODES"
          :key="mode"
          :value="mode"
          :label="modeLabel(mode)"
        />
      </el-select>
    </el-form-item>
    <div class="rule-grid">
      <el-form-item :label="t('overdraft.fixedAmount')"
        ><el-input-number
          :model-value="modelValue.fixedAmount"
          :min="0"
          :max="maximum"
          :precision="4"
          @update:model-value="update('fixedAmount', $event ?? 0)"
      /></el-form-item>
      <el-form-item :label="t('overdraft.percent')"
        ><el-input-number
          :model-value="modelValue.percent"
          :min="0"
          :max="maximum"
          :precision="4"
          @update:model-value="update('percent', $event ?? 0)"
      /></el-form-item>
      <el-form-item :label="t('overdraft.minimum')"
        ><el-input-number
          :model-value="modelValue.minimum"
          :min="0"
          :max="maximum"
          :precision="4"
          @update:model-value="update('minimum', $event ?? 0)"
      /></el-form-item>
      <el-form-item :label="t('overdraft.maximum')">
        <el-switch
          :model-value="modelValue.maximum !== null"
          @update:model-value="update('maximum', $event ? maximum : null)"
        />
        <el-input-number
          v-if="modelValue.maximum !== null"
          :model-value="modelValue.maximum"
          :min="modelValue.minimum"
          :max="maximum"
          :precision="4"
          @update:model-value="update('maximum', $event ?? 0)"
        />
        <span v-else>{{ t('overdraft.noMaximum') }}</span>
      </el-form-item>
    </div>
    <el-form-item v-if="modelValue.mode === 'formula'" :label="t('overdraft.formula')">
      <el-input
        :model-value="modelValue.formula"
        type="textarea"
        :rows="2"
        :maxlength="BALANCE_MANAGEMENT_POLICY.formulaLength"
        @update:model-value="update('formula', $event)"
      />
      <p class="rule-hint">{{ t('overdraft.formulaHint') }}</p>
      <el-button
        text
        @click="update('formula', 'min(100, fixedAmount + totalRecharged * percent / 100)')"
        >{{ t('overdraft.example') }}</el-button
      >
    </el-form-item>
    <el-alert :closable="false" :title="t('overdraft.basisHint')" type="info" />
  </el-form>
</template>
<script setup lang="ts">
import {
  BALANCE_MANAGEMENT_POLICY,
  BALANCE_OVERDRAFT_MODES,
  type BalanceOverdraftMode,
  type BalanceOverdraftRule,
} from '@quyan/shared'
import { i18ns } from '@/locales'
const props = defineProps<{ modelValue: BalanceOverdraftRule }>()
const emit = defineEmits<{ 'update:modelValue': [value: BalanceOverdraftRule] }>()
const t = i18ns.t
const maximum = BALANCE_MANAGEMENT_POLICY.maximumAmount
const modeLabel = (mode: BalanceOverdraftMode) => t(`overdraft.modes.${mode}`)
function update<K extends keyof BalanceOverdraftRule>(field: K, value: BalanceOverdraftRule[K]) {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}
</script>
<style scoped>
.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.overdraft-rule :deep(.el-select),
.overdraft-rule :deep(.el-input-number) {
  width: 100%;
}
.rule-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 600px) {
  .rule-grid {
    grid-template-columns: 1fr;
  }
}
</style>
