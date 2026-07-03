<template>
  <div class="json-node" :class="{ 'is-root': isRoot }">
    <!-- Object -->
    <div v-if="isObject" class="node-object">
      <div class="node-header">
        <el-icon class="node-icon"><Folder /></el-icon>
        <span class="node-type">{{ i18ns.t('jsonEndpoint.object') }}</span>
        <el-button
          v-if="!isRoot"
          link
          type="danger"
          size="small"
          :icon="Delete"
          @click="handleDelete"
        />
      </div>
      <div class="node-children">
        <div v-for="(value, key) in modelValue" :key="key" class="property-item">
          <div class="property-header">
            <el-input
              :model-value="getDisplayKey(String(key))"
              size="small"
              class="property-key"
              :placeholder="i18ns.t('jsonEndpoint.keyName')"
              @input="(val: string) => handleKeyInput(String(key), val)"
              @blur="() => handleKeyBlur(String(key))"
            />
            <el-button
              link
              type="danger"
              size="small"
              :icon="Close"
              @click="handleDeleteProperty(String(key))"
            />
          </div>
          <JsonNode
            :model-value="value"
            :path="[...path, String(key)]"
            @update:modelValue="(newValue) => handlePropertyUpdate(String(key), newValue)"
            @delete="handleDeleteProperty(String(key))"
          />
        </div>
        <el-button size="small" :icon="Plus" @click="handleAddProperty">
          {{ i18ns.t('jsonEndpoint.addProperty') }}
        </el-button>
      </div>
    </div>

    <!-- Array -->
    <div v-else-if="isArray" class="node-array">
      <div class="node-header">
        <el-icon class="node-icon"><List /></el-icon>
        <span class="node-type">{{ i18ns.t('jsonEndpoint.array') }} [{{ modelValue.length }}]</span>
        <el-button
          v-if="!isRoot"
          link
          type="danger"
          size="small"
          :icon="Delete"
          @click="handleDelete"
        />
      </div>
      <div class="node-children">
        <div v-for="(item, index) in modelValue" :key="index" class="array-item">
          <div class="array-index">[{{ index }}]</div>
          <JsonNode
            :model-value="item"
            :path="[...path, Number(index)]"
            @update:modelValue="(newValue) => handleArrayItemUpdate(Number(index), newValue)"
            @delete="handleDeleteArrayItem(Number(index))"
          />
        </div>
        <el-dropdown @command="handleAddArrayItem">
          <el-button size="small" :icon="Plus">
            {{ i18ns.t('jsonEndpoint.addItem') }}
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="string">{{
                i18ns.t('jsonEndpoint.string')
              }}</el-dropdown-item>
              <el-dropdown-item command="number">{{
                i18ns.t('jsonEndpoint.number')
              }}</el-dropdown-item>
              <el-dropdown-item command="boolean">{{
                i18ns.t('jsonEndpoint.boolean')
              }}</el-dropdown-item>
              <el-dropdown-item command="null">{{ i18ns.t('jsonEndpoint.null') }}</el-dropdown-item>
              <el-dropdown-item command="object">{{
                i18ns.t('jsonEndpoint.object')
              }}</el-dropdown-item>
              <el-dropdown-item command="array">{{
                i18ns.t('jsonEndpoint.array')
              }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- Primitive values -->
    <div v-else class="node-primitive">
      <div class="primitive-controls">
        <el-select
          :model-value="valueType"
          size="small"
          class="type-select"
          @change="handleTypeChange"
        >
          <el-option value="string" :label="i18ns.t('jsonEndpoint.string')" />
          <el-option value="number" :label="i18ns.t('jsonEndpoint.number')" />
          <el-option value="boolean" :label="i18ns.t('jsonEndpoint.boolean')" />
          <el-option value="null" :label="i18ns.t('jsonEndpoint.null')" />
          <el-option value="object" :label="i18ns.t('jsonEndpoint.object')" />
          <el-option value="array" :label="i18ns.t('jsonEndpoint.array')" />
        </el-select>

        <!-- String input -->
        <el-input
          v-if="valueType === 'string'"
          :model-value="modelValue"
          size="small"
          class="value-input"
          :placeholder="i18ns.t('jsonEndpoint.enterValue')"
          @input="handleValueChange"
        />

        <!-- Number input -->
        <el-input-number
          v-else-if="valueType === 'number'"
          :model-value="modelValue"
          size="small"
          class="value-input"
          :controls="false"
          @input="handleValueChange"
        />

        <!-- Boolean switch -->
        <el-switch
          v-else-if="valueType === 'boolean'"
          :model-value="modelValue"
          size="small"
          @change="handleValueChange"
        />

        <!-- Null display -->
        <span v-else-if="valueType === 'null'" class="null-value">null</span>

        <el-button
          v-if="!isRoot"
          link
          type="danger"
          size="small"
          :icon="Delete"
          @click="handleDelete"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { i18ns } from '@/locales'
import { Plus, Delete, Close, Folder, List } from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: any
  path: (string | number)[]
  isRoot?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
  (e: 'delete'): void
}>()

// 用于存储正在编辑的 key 值
const editingKeys = ref<Record<string, string>>({})

const isObject = computed(() => {
  return (
    props.modelValue !== null &&
    typeof props.modelValue === 'object' &&
    !Array.isArray(props.modelValue)
  )
})

const isArray = computed(() => {
  return Array.isArray(props.modelValue)
})

const valueType = computed(() => {
  if (props.modelValue === null) return 'null'
  if (Array.isArray(props.modelValue)) return 'array'
  return typeof props.modelValue
})

// 获取当前显示的 key 值（正在编辑的或原始的）
const getDisplayKey = (key: string) => {
  return editingKeys.value[key] !== undefined ? editingKeys.value[key] : key
}

// Object operations
const handleAddProperty = () => {
  const newKey = `key${Object.keys(props.modelValue).length + 1}`
  emit('update:modelValue', { ...props.modelValue, [newKey]: '' })
}

const handleKeyInput = (oldKey: string, newValue: string) => {
  // 存储正在编辑的值
  editingKeys.value[oldKey] = newValue
}

const handleKeyBlur = (oldKey: string) => {
  const newKey = editingKeys.value[oldKey]

  // 清除编辑状态
  delete editingKeys.value[oldKey]

  if (!newKey || oldKey === newKey) return

  // 检查新键名是否已存在
  if (newKey in props.modelValue && newKey !== oldKey) {
    // 键名冲突，不执行更改
    return
  }

  const newObj = { ...props.modelValue }
  newObj[newKey] = newObj[oldKey]
  delete newObj[oldKey]
  emit('update:modelValue', newObj)
}

const handlePropertyUpdate = (key: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const handleDeleteProperty = (key: string) => {
  const newObj = { ...props.modelValue }
  delete newObj[key]
  emit('update:modelValue', newObj)
}

// Array operations
const handleAddArrayItem = (type: string) => {
  let newItem: any
  switch (type) {
    case 'string':
      newItem = ''
      break
    case 'number':
      newItem = 0
      break
    case 'boolean':
      newItem = false
      break
    case 'null':
      newItem = null
      break
    case 'object':
      newItem = {}
      break
    case 'array':
      newItem = []
      break
    default:
      newItem = ''
  }
  emit('update:modelValue', [...props.modelValue, newItem])
}

const handleArrayItemUpdate = (index: number, value: any) => {
  const newArray = [...props.modelValue]
  newArray[index] = value
  emit('update:modelValue', newArray)
}

const handleDeleteArrayItem = (index: number) => {
  const newArray = [...props.modelValue]
  newArray.splice(index, 1)
  emit('update:modelValue', newArray)
}

// Primitive operations
const handleTypeChange = (newType: string) => {
  let newValue: any
  switch (newType) {
    case 'string':
      newValue = String(props.modelValue || '')
      break
    case 'number':
      newValue = Number(props.modelValue) || 0
      break
    case 'boolean':
      newValue = Boolean(props.modelValue)
      break
    case 'null':
      newValue = null
      break
    case 'object':
      newValue = {}
      break
    case 'array':
      newValue = []
      break
    default:
      newValue = ''
  }
  emit('update:modelValue', newValue)
}

const handleValueChange = (value: any) => {
  emit('update:modelValue', value)
}

const handleDelete = () => {
  emit('delete')
}
</script>

<style scoped>
.json-node {
  margin-left: 0;
}

.json-node:not(.is-root) {
  margin-left: 24px;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.node-icon {
  color: var(--el-color-primary);
}

.node-type {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.node-children {
  margin-left: 16px;
  padding-left: 12px;
  border-left: 2px solid var(--el-border-color-lighter);
}

.property-item,
.array-item {
  margin-bottom: 12px;
}

.property-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.property-key {
  max-width: 200px;
}

.array-index {
  display: inline-block;
  padding: 2px 8px;
  margin-bottom: 8px;
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.node-primitive {
  margin-bottom: 8px;
}

.primitive-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.type-select {
  width: 120px;
}

.value-input {
  flex: 1;
  max-width: 300px;
}

.null-value {
  padding: 0 12px;
  color: var(--el-text-color-secondary);
  font-style: italic;
}
</style>
