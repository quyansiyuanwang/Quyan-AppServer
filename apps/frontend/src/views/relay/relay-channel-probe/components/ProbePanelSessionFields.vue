<template>
  <div class="session-fields">
    <div v-for="(field, index) in modelValue" :key="index" class="session-field">
      <el-input
        :model-value="field.name"
        :placeholder="i18ns.t('relay.probeSessionFieldName')"
        @update:model-value="set(index, 'name', $event)"
      />
      <el-select :model-value="field.source" @update:model-value="set(index, 'source', $event)">
        <el-option value="json" label="JSON" /><el-option
          value="header"
          :label="i18ns.t('relay.probeSessionHeader')"
        /><el-option value="cookie" label="Cookie" />
      </el-select>
      <el-input
        :model-value="field.selector"
        :placeholder="i18ns.t('relay.probeSessionSelector')"
        @update:model-value="set(index, 'selector', $event)"
      />
      <el-checkbox
        :model-value="field.required"
        @update:model-value="set(index, 'required', Boolean($event))"
        >{{ i18ns.t('relay.probeSessionRequired') }}</el-checkbox
      >
      <el-button
        type="danger"
        link
        @click="
          emit(
            'update:modelValue',
            modelValue.filter((_, position) => position !== index),
          )
        "
        >{{ i18ns.t('delete') }}</el-button
      >
      <small v-if="field.name">{{ formatProbeSessionVariable(field.name) }}</small>
    </div>
    <el-button
      link
      :disabled="modelValue.length >= 12"
      @click="
        emit('update:modelValue', [
          ...modelValue,
          { name: '', source: 'json', selector: '', required: false },
        ])
      "
      >{{ i18ns.t('add') }}</el-button
    >
  </div>
</template>
<script setup lang="ts">
import type { RelayProbeAccountSessionFieldDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
const props = defineProps<{ modelValue: RelayProbeAccountSessionFieldDto[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: RelayProbeAccountSessionFieldDto[]] }>()
function set(index: number, key: keyof RelayProbeAccountSessionFieldDto, value: string | boolean) {
  emit(
    'update:modelValue',
    props.modelValue.map((field, position) =>
      position === index ? { ...field, [key]: value } : field,
    ),
  )
}
const formatProbeSessionVariable = (name: string) => `{{account.${name}}}`
</script>
<style scoped>
.session-fields {
  width: 100%;
}
.session-field {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 100px minmax(130px, 1.5fr) auto auto;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
small {
  grid-column: 1 / -1;
  color: var(--el-text-color-secondary);
}
@media (max-width: 650px) {
  .session-field {
    grid-template-columns: 1fr 1fr;
  }
  small {
    grid-column: 1 / -1;
  }
}
</style>
