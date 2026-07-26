<template>
  <div class="probe-key-value-editor">
    <div v-if="modelValue.length" class="entry-list">
      <div v-for="(entry, index) in modelValue" :key="entry.id" class="entry-row">
        <el-input
          :model-value="entry.key"
          :disabled="disabled"
          :placeholder="keyPlaceholder"
          @update:model-value="updateEntry(index, 'key', $event)"
        />
        <el-select
          v-if="valueMode === 'json'"
          :model-value="entry.valueType"
          :disabled="disabled"
          class="value-type"
          @update:model-value="updateEntry(index, 'valueType', $event)"
        >
          <el-option value="text" :label="i18ns.t('relay.channelProbeValueText')" />
          <el-option value="number" :label="i18ns.t('relay.channelProbeValueNumber')" />
          <el-option value="boolean" :label="i18ns.t('relay.channelProbeValueBoolean')" />
          <el-option value="json" label="JSON" />
        </el-select>
        <el-input
          :model-value="entry.value"
          :disabled="disabled"
          :placeholder="valuePlaceholder"
          @update:model-value="updateEntry(index, 'value', $event)"
        />
        <el-tooltip :content="i18ns.t('delete')">
          <el-button
            :icon="Delete"
            circle
            plain
            type="danger"
            :disabled="disabled"
            @click="removeEntry(index)"
          />
        </el-tooltip>
      </div>
    </div>
    <div v-else class="entry-empty">{{ emptyText }}</div>
    <el-button v-if="!disabled" :icon="Plus" link type="primary" @click="addEntry">
      {{ i18ns.t('add') }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { Delete, Plus } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'

export type ProbeValueType = 'text' | 'number' | 'boolean' | 'json'

export interface ProbeKeyValueEntry {
  id: string
  key: string
  value: string
  valueType: ProbeValueType
}

interface Props {
  modelValue: ProbeKeyValueEntry[]
  disabled?: boolean
  emptyText: string
  keyPlaceholder: string
  valuePlaceholder: string
  valueMode?: 'text' | 'json'
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  valueMode: 'text',
})

const emit = defineEmits<{
  'update:modelValue': [value: ProbeKeyValueEntry[]]
}>()

const updateEntry = (
  index: number,
  field: keyof Pick<ProbeKeyValueEntry, 'key' | 'value' | 'valueType'>,
  value: string,
) => {
  emit(
    'update:modelValue',
    props.modelValue.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  )
}

const addEntry = () => {
  emit('update:modelValue', [
    ...props.modelValue,
    { id: crypto.randomUUID(), key: '', value: '', valueType: 'text' },
  ])
}

const removeEntry = (index: number) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, entryIndex) => entryIndex !== index),
  )
</script>

<style scoped>
.probe-key-value-editor {
  display: grid;
  gap: 8px;
}

.entry-list {
  display: grid;
  gap: 8px;
}

.entry-empty {
  padding: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.8fr) minmax(0, 1.5fr) 32px;
  gap: 8px;
  align-items: center;
}

.entry-row:has(.value-type) {
  grid-template-columns: minmax(110px, 0.8fr) 112px minmax(0, 1.5fr) 32px;
}

@media (max-width: 600px) {
  .entry-row,
  .entry-row:has(.value-type) {
    grid-template-columns: 1fr 32px;
  }

  .entry-row > :not(.el-button) {
    grid-column: 1;
  }

  .entry-row > .el-button {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
