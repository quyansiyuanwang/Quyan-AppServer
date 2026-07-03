<template>
  <div class="filter-table-select">
    <el-popover
      placement="bottom-start"
      :width="popoverWidth"
      trigger="click"
      @show="onPopoverShow"
    >
      <template #reference>
        <div class="custom-select-trigger" :class="{ 'is-active': selectedKeys.length > 0 }">
          <span v-if="selectedKeys.length === 0" class="placeholder">{{ placeholder }}</span>
          <span v-else class="selected-text">{{ selectedText }}</span>
          <el-icon class="arrow-icon"><ArrowDown /></el-icon>
        </div>
      </template>

      <div class="popover-content">
        <div class="popover-header">
          <el-input
            v-model="searchQuery"
            clearable
            :placeholder="searchPlaceholder"
            size="small"
            class="search-input"
          />
          <div class="actions">
            <el-button size="small" @click="selectAll">全选</el-button>
            <el-button size="small" @click="invertSelection">反选</el-button>
            <el-button size="small" @click="clearSelection">清空</el-button>
          </div>
        </div>

        <el-table
          ref="tableRef"
          :data="filteredOptions"
          row-key="key"
          height="280"
          size="small"
          @selection-change="onSelectionChange"
        >
          <el-table-column type="selection" width="50" :reserve-selection="true" />
          <el-table-column prop="label" :label="columnLabel" />
        </el-table>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { ElTable } from 'element-plus'

interface OptionItem {
  key: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    options: OptionItem[]
    placeholder?: string
    searchPlaceholder?: string
    columnLabel?: string
    popoverWidth?: number
  }>(),
  {
    placeholder: '请选择',
    searchPlaceholder: '搜索...',
    columnLabel: '名称',
    popoverWidth: 400,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string[]): void
}>()

const tableRef = ref<InstanceType<typeof ElTable>>()
const searchQuery = ref('')
const internalSelection = ref<string[]>([])
let isUpdatingTable = false

const buildRegex = (input: string): RegExp => {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('empty regex')
  }

  const literalMatch = trimmed.match(/^\/(.*)\/([a-z]*)$/i)
  if (literalMatch) {
    const pattern = literalMatch[1] ?? ''
    const flags = literalMatch[2] ?? 'i'
    return new RegExp(pattern, flags)
  }

  return new RegExp(trimmed, 'i')
}

const filteredOptions = computed(() => {
  if (!searchQuery.value) return props.options

  try {
    const regex = buildRegex(searchQuery.value)
    return props.options.filter((item) => regex.test(`${item.label} ${item.key}`))
  } catch {
    const q = searchQuery.value.toLowerCase()
    return props.options.filter(
      (item) => item.label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q),
    )
  }
})

const selectedKeys = computed(() => props.modelValue)

const selectedText = computed(() => {
  if (selectedKeys.value.length === 0) return props.placeholder
  const count = selectedKeys.value.length
  const maxDisplay = 2
  const displayItems = props.options
    .filter((opt) => selectedKeys.value.includes(opt.key))
    .slice(0, maxDisplay)
    .map((opt) => opt.label)
    .join(', ')

  if (count > maxDisplay) {
    return `${displayItems} (+${count - maxDisplay})`
  }
  return displayItems
})

const onSelectionChange = (selection: OptionItem[]) => {
  if (isUpdatingTable) return
  const keys = selection.map((item) => item.key)
  internalSelection.value = keys
  emit('update:modelValue', keys)
}

const syncTableSelection = async () => {
  if (!tableRef.value) return
  isUpdatingTable = true

  tableRef.value.clearSelection()
  const selectedSet = new Set(props.modelValue)

  // We need to match actual objects for ElTable
  const rowsToSelect = props.options.filter((opt) => selectedSet.has(opt.key))
  rowsToSelect.forEach((row) => {
    tableRef.value!.toggleRowSelection(row, true)
  })

  await nextTick()
  isUpdatingTable = false
}

watch(
  () => props.modelValue,
  () => {
    syncTableSelection()
  },
  { deep: true },
)

const onPopoverShow = () => {
  searchQuery.value = ''
  nextTick(() => {
    syncTableSelection()
  })
}

const selectAll = () => {
  // If searched, select all searched items
  const currentKeys = new Set(props.modelValue)
  filteredOptions.value.forEach((opt) => currentKeys.add(opt.key))
  emit('update:modelValue', Array.from(currentKeys))
}

const invertSelection = () => {
  const currentKeys = new Set(props.modelValue)

  // Only invert within the searched results or all if no search
  filteredOptions.value.forEach((opt) => {
    if (currentKeys.has(opt.key)) {
      currentKeys.delete(opt.key)
    } else {
      currentKeys.add(opt.key)
    }
  })

  emit('update:modelValue', Array.from(currentKeys))
}

const clearSelection = () => {
  // If searched, clear only searched ones, otherwise clear all
  if (searchQuery.value) {
    const currentKeys = new Set(props.modelValue)
    filteredOptions.value.forEach((opt) => {
      currentKeys.delete(opt.key)
    })
    emit('update:modelValue', Array.from(currentKeys))
  } else {
    emit('update:modelValue', [])
  }
}
</script>

<style scoped>
.custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 4px 11px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background-color: var(--el-fill-color-blank);
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
}

.custom-select-trigger:hover {
  border-color: var(--el-border-color-hover);
}

.custom-select-trigger.is-active {
  border-color: var(--el-color-primary);
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}

.selected-text {
  color: var(--el-text-color-regular);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 8px;
}

.arrow-icon {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  transition: transform 0.3s;
}

.popover-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.actions {
  display: flex;
  gap: 8px;
}

.search-input {
  width: 100%;
}
</style>
