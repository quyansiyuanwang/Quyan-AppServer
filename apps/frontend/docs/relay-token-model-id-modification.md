# 前端令牌管理修改方案

## 问题描述

当用户在令牌编辑页面选择模型时：
- 当前：显示并选择**模型名称**，保存时直接存储模型名称
- 问题：如果一个模型ID对应多个模型名称（不同渠道），只选择一个模型名称会导致其他渠道请求失败

## 解决方案

用户选择**模型ID**，保存时转换为**所有对应的模型名称**。

## 后端API修改（已完成）

### 1. DTO修改 (`relay.dto.ts`)
```typescript
export interface RelayAvailableModelsMapDto {
  modelNames: string[];                              // 所有模型名称
  modelIdToModelNameMap: Record<string, string>;     // 一对一映射
  modelIdToModelNamesMap: Record<string, string[]>;  // 一对多映射（新增）
  modelIds: string[];                                // 所有模型ID（新增）
}
```

### 2. Service修改 (`relay-token.service.ts`)
- 构建 `modelIdToModelNamesMap`：包含所有模型ID到模型名称的映射
- 构建 `modelIds`：去重后的模型ID列表

## 前端修改方案

### 文件：`RelayTokenManagementView.vue`

#### 1. 修改数据结构

```typescript
// 当前
const availableModels = ref<string[]>([])  // 模型名称列表
const modelIdToModelNameMap = ref<Map<string, string>>(new Map())  // 一对一映射

// 修改为
const availableModelIds = ref<string[]>([])  // 模型ID列表（新增）
const availableModels = ref<string[]>([])  // 保留，用于内部逻辑
const modelIdToModelNameMap = ref<Map<string, string>>(new Map())  // 保留
const modelIdToModelNamesMap = ref<Map<string, string[]>>(new Map())  // 一对多映射（新增）
```

#### 2. 修改 `loadAvailableModels` 函数

```typescript
const loadAvailableModels = async () => {
  loadingModels.value = true
  try {
    const modelsMap = await relayTokenService.getAvailableModels()
    availableModels.value = modelsMap.modelNames
    availableModelIds.value = modelsMap.modelIds  // 新增
    modelIdToModelNameMap.value = new Map(Object.entries(modelsMap.modelIdToModelNameMap))
    modelIdToModelNamesMap.value = new Map(Object.entries(modelsMap.modelIdToModelNamesMap))  // 新增
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    throw error
  } finally {
    loadingModels.value = false
  }
}
```

#### 3. 修改 `filteredModels` 计算属性

将其改名为 `filteredModelIds`，返回模型ID而不是模型名称：

```typescript
const filteredModelIds = computed(() => {
  const selectedChannelIds = editForm.value.channelConfigs
    .map((config) => config.channelId)
    .filter((id) => id)

  if (selectedChannelIds.length === 0) return availableModelIds.value

  // 收集所有选中渠道允许的模型名称
  const allAllowedModelNames = new Set<string>()

  for (const channelId of selectedChannelIds) {
    const selectedChannel = channels.value.find((ch) => ch.id === channelId)
    if (!selectedChannel || !selectedChannel.allowedModels) {
      // 渠道无限制，添加所有模型
      availableModels.value.forEach((model) => allAllowedModelNames.add(model))
      continue
    }

    try {
      const parsedAllowedModels = JSON.parse(selectedChannel.allowedModels)
      if (Array.isArray(parsedAllowedModels)) {
        parsedAllowedModels.forEach((modelName) => {
          const normalized = String(modelName || '').trim()
          if (normalized) allAllowedModelNames.add(normalized)
        })
      }
    } catch {
      availableModels.value.forEach((model) => allAllowedModelNames.add(model))
    }
  }

  // 找出哪些模型ID的所有模型名称都被允许
  const allowedModelIds: string[] = []
  for (const modelId of availableModelIds.value) {
    const modelNames = modelIdToModelNamesMap.value.get(modelId) || []
    if (modelNames.length === 0) continue

    // 检查该模型ID的所有模型名称是否都被允许
    const allNamesAllowed = modelNames.every((name) => allAllowedModelNames.has(name))
    if (allNamesAllowed) {
      allowedModelIds.push(modelId)
    }
  }

  return allowedModelIds.length > 0 ? allowedModelIds : availableModelIds.value
})
```

#### 4. 修改模板中的选择器

```vue
<!-- 当前 -->
<el-select
  v-model="editForm.allowedModelsList"
  multiple
  filterable
  :placeholder="i18ns.t('relay.selectModels')"
  style="width: 100%"
  :loading="loadingModels"
>
  <el-option
    v-for="model in filteredModels"
    :key="model"
    :label="model"
    :value="model"
  />
</el-select>

<!-- 修改为 -->
<el-select
  v-model="editForm.allowedModelIdsList"
  multiple
  filterable
  :placeholder="i18ns.t('relay.selectModels')"
  style="width: 100%"
  :loading="loadingModels"
>
  <el-option
    v-for="modelId in filteredModelIds"
    :key="modelId"
    :label="getModelIdDisplayLabel(modelId)"
    :value="modelId"
  />
</el-select>
```

#### 5. 添加辅助函数

```typescript
// 获取模型ID的显示标签
const getModelIdDisplayLabel = (modelId: string): string => {
  const modelNames = modelIdToModelNamesMap.value.get(modelId) || []
  if (modelNames.length === 0) return modelId
  if (modelNames.length === 1) return `${modelId} (${modelNames[0]})`
  return `${modelId} (${modelNames.length} models)`
}
```

#### 6. 修改 `openEditDialog` 函数

```typescript
const openEditDialog = (row: RelayTokenDto) => {
  editMode.value = 'edit'
  currentEditId.value = row.id

  // 将模型名称转换为模型ID
  const modelNamesList = row.allowedModels ? row.allowedModels.split(',').map((m) => m.trim()) : []
  const modelIdsList: string[] = []

  // 反向查找：模型名称 -> 模型ID
  for (const modelName of modelNamesList) {
    // 查找哪个模型ID包含这个模型名称
    for (const [modelId, modelNames] of modelIdToModelNamesMap.value.entries()) {
      if (modelNames.includes(modelName) && !modelIdsList.includes(modelId)) {
        modelIdsList.push(modelId)
        break
      }
    }
  }

  editForm.value = {
    // ... 其他字段
    allowedModelIdsList: modelIdsList,  // 使用模型ID列表
  }
  showEditDialog.value = true
}
```

#### 7. 修改 `handleSave` 函数

```typescript
const handleSave = async () => {
  saving.value = true
  try {
    const channelConfigs = buildChannelConfigsPayload()

    // 将模型ID转换为所有对应的模型名称
    const allModelNames = new Set<string>()
    for (const modelId of editForm.value.allowedModelIdsList) {
      const modelNames = modelIdToModelNamesMap.value.get(modelId) || []
      modelNames.forEach((name) => allModelNames.add(name))
    }

    const allowedModelsStr = allModelNames.size > 0 ? Array.from(allModelNames).join(',') : ''

    // ... 其余保存逻辑
  } catch (error) {
    // ... 错误处理
  } finally {
    saving.value = false
  }
}
```

#### 8. 修改 `editForm` 结构

```typescript
const createEmptyEditForm = () => ({
  name: '',
  channelId: '',
  quotaLimit: null as number | null,
  allowedModels: '',
  allowedModelIdsList: [] as string[],  // 改为模型ID列表
  channelConfigs: [createEmptyChannelConfig(0)] as EditableChannelConfig[],
  failoverConfig: createDefaultFailoverConfig() as EditableFailoverConfig,
})
```

#### 9. 修改 watch 逻辑

```typescript
watch(
  () => editForm.value.channelConfigs.map((config) => config.channelId),
  () => {
    editForm.value.channelId = editForm.value.channelConfigs[0]?.channelId || ''
    if (!editForm.value.allowedModelIdsList.length) return
    const validModelIds = new Set(filteredModelIds.value)
    editForm.value.allowedModelIdsList = editForm.value.allowedModelIdsList.filter((modelId) =>
      validModelIds.has(modelId),
    )
  },
  { deep: true },
)
```

## 测试场景

### 场景1：单个模型ID对应单个模型名称
- 模型配置：`{ model: "gpt-5.4-.1C", provider: "gpt-5.4" }`
- 用户选择：`gpt-5.4`
- 保存结果：`allowedModels = "gpt-5.4-.1C"`

### 场景2：单个模型ID对应多个模型名称
- 模型配置：
  - `{ model: "gpt-5.4-premium", provider: "gpt-5.4" }`
  - `{ model: "gpt-5.4-standard", provider: "gpt-5.4" }`
- 用户选择：`gpt-5.4`
- 保存结果：`allowedModels = "gpt-5.4-premium,gpt-5.4-standard"`

### 场景3：多个模型ID
- 用户选择：`gpt-5.4`, `gpt-5.3-codex`
- 保存结果：包含所有对应的模型名称

## 优势

1. **用户体验**：用户只需选择模型ID，不需要关心内部的模型名称
2. **兼容性**：支持多渠道使用相同模型ID但不同价格的场景
3. **自动化**：自动将模型ID转换为所有对应的模型名称，避免遗漏
