<template>
  <section class="settings-editor">
    <div class="heading">
      <h2>{{ label }}</h2>
      <p>{{ description }}</p>
    </div>
    <el-table :data="entries" size="small">
      <el-table-column label="配置项" min-width="180"
        ><template #default="{ row }"
          ><el-input v-model="row.key" placeholder="配置名称" /></template
      ></el-table-column>
      <el-table-column label="值" min-width="240"
        ><template #default="{ row }"
          ><el-input v-model="row.value" placeholder="文本、数字或 true/false" /></template
      ></el-table-column>
      <el-table-column label="操作" width="72"
        ><template #default="{ $index }"
          ><el-button link type="danger" @click="remove($index)">删除</el-button></template
        ></el-table-column
      >
    </el-table>
    <el-button plain size="small" @click="add">添加配置项</el-button>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  modelValue: Record<string, unknown>
  label: string
  description: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>()
type Entry = { key: string; value: string }
const stringify = (value: unknown) => (typeof value === 'string' ? value : String(value))
const entries = computed<Entry[]>({
  get: () =>
    Object.entries(props.modelValue || {}).map(([key, value]) => ({
      key,
      value: stringify(value),
    })),
  set: (value) =>
    emit(
      'update:modelValue',
      value.reduce<Record<string, unknown>>((record, entry) => {
        if (entry.key.trim()) record[entry.key.trim()] = parse(entry.value)
        return record
      }, {}),
    ),
})
const parse = (value: string): unknown =>
  value === 'true'
    ? true
    : value === 'false'
      ? false
      : value !== '' && !Number.isNaN(Number(value))
        ? Number(value)
        : value
const add = () => {
  entries.value = [...entries.value, { key: '', value: '' }]
}
const remove = (index: number) => {
  entries.value = entries.value.filter((_, current) => current !== index)
}
</script>
<style scoped>
.settings-editor {
  margin-top: 20px;
}
.heading h2 {
  font-size: 17px;
  margin: 0 0 6px;
}
.heading p {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.settings-editor > .el-button {
  margin-top: 10px;
}
</style>
