# API中转模型ID设计方案总结

## 设计原则

**数据存储模型名称，用户使用模型ID，根据模型ID+渠道选择模型配置**

### 核心理念

- **allowedModels 存储模型名称**：渠道和令牌的 allowedModels 字段存储模型名称（model字段）
- **用户请求使用模型ID**：客户端使用模型ID（provider字段）发起请求
- **多模型支持**：同一个模型ID可以对应多个模型配置（不同价格、不同名称）
- **渠道选择模型**：根据模型ID和渠道的allowedModels，选择对应的模型配置

### 优势

1. **灵活性**：修改模型ID不影响现有配置
2. **稳定性**：避免数据同步问题
3. **可维护性**：管理员看到的是模型名称，更容易识别
4. **多价格支持**：同一个模型ID可以有不同的价格策略（premium/standard）

## 数据结构

### ModelPricing 表

**支持多个模型使用相同的模型ID：**

```typescript
// Premium 版本
{
  model: "gpt-5.4-premium",       // 模型名称（唯一标识）
  provider: "gpt-5.4",            // 模型ID（用户请求时使用）
  pricingType: "token-based",
  inputPrice: 10,
  outputPrice: 20,
  // ...
}

// Standard 版本
{
  model: "gpt-5.4-standard",      // 不同的模型名称
  provider: "gpt-5.4",            // 相同的模型ID
  pricingType: "token-based",
  inputPrice: 5,
  outputPrice: 10,
  // ...
}
```

### RelayChannel 表

```typescript
{
  // 渠道可以选择使用哪个版本的模型
  allowedModels: '["gpt-5.4-premium", "gpt-5.3-codex-.1C"]'; // JSON数组，存储模型名称
}
```

### RelayToken 表

```typescript
{
  allowedModels: "gpt-5.4-premium,gpt-5.3-codex-.1C"; // 逗号分隔，存储模型名称
}
```

## 请求流程

### 1. 客户端请求

```http
POST /relay/proxy/v1/chat/completions
Authorization: Bearer rlt_xxx
Content-Type: application/json

{
  "model": "gpt-5.4",  // 使用模型ID
  "messages": [...]
}
```

### 2. 后端处理流程

```typescript
// 步骤1: 根据模型ID找到所有匹配的模型配置
const candidateConfigs = resolveRequestedModelConfigs(modelPricing, "gpt-5.4");
// 结果: [
//   { model: "gpt-5.4-premium", provider: "gpt-5.4", inputPrice: 10, ... },
//   { model: "gpt-5.4-standard", provider: "gpt-5.4", inputPrice: 5, ... }
// ]

// 步骤2: 检查令牌限制（使用模型名称）
const tokenAllowedModels = ["gpt-5.4-premium", "gpt-5.3-codex-.1C"];
// 检查是否有任何候选模型被令牌允许
const tokenAllowsAny = candidateConfigs.some(config =>
  isModelNameAllowed(tokenAllowedModels, config.model)
);

// 步骤3: 遍历渠道，为每个渠道选择对应的模型配置
for (const channel of channels) {
  const channelAllowedModels = ["gpt-5.4-premium", "gpt-5.3-codex-.1C"];

  // 从候选配置中选择渠道允许的那个
  const channelModelConfig = candidateConfigs.find(config =>
    isModelNameAllowed(channelAllowedModels, config.model)
  );
  // 结果: { model: "gpt-5.4-premium", provider: "gpt-5.4", inputPrice: 10, ... }

  // 步骤4: 使用该渠道对应的模型配置（价格、名称等）
  const price = channelModelConfig.inputPrice; // 10
  const modelName = channelModelConfig.model;  // "gpt-5.4-premium"

  // 步骤5: 转发到上游（使用模型ID）
  upstream.request({ model: "gpt-5.4", ... });
}
```

## 前端显示

### 用户侧（/relay/api-docs）

显示**模型ID**，方便复制使用：

```
┌─────────────────────────────────────┐
│ 可用模型                             │
├─────────────────────────────────────┤
│ gpt-5.4 [ID]                        │
│ gpt-5.3-codex [ID]                  │
│ gpt-image-2 [ID]                    │
└─────────────────────────────────────┘
```

### 管理侧（渠道/令牌管理）

显示**模型ID（模型名称）**，便于识别：

```
┌─────────────────────────────────────┐
│ 允许的模型                           │
├─────────────────────────────────────┤
│ ☑ gpt-5.4 (gpt-5.4-.1C)            │
│ ☑ gpt-5.3-codex (gpt-5.3-codex-.1C)│
│ ☐ gpt-image-2 (GPT Image 2)        │
└─────────────────────────────────────┘
```

## 修改模型ID的影响

### 场景：修改模型ID

```sql
-- 修改前
model: "gpt-5.3-codex-.1C"
provider: "gpt-5.3-codex"

-- 修改后
model: "gpt-5.3-codex-.1C"
provider: "gpt-5.3-codex-spark"
```

### 影响分析

✅ **渠道配置**：无需修改（存储的是模型名称 `gpt-5.3-codex-.1C`）
✅ **令牌配置**：无需修改（存储的是模型名称 `gpt-5.3-codex-.1C`）
⚠️ **客户端**：需要更新请求，使用新的模型ID `gpt-5.3-codex-spark`
⚠️ **旧模型ID**：`gpt-5.3-codex` 将无法使用（找不到对应的模型配置）

### 建议

如果需要修改模型ID，建议：

1. 创建新模型而不是修改现有模型
2. 通知用户更新客户端
3. 保留旧模型一段时间，逐步迁移

## 代码修改清单

### 后端修改

#### 1. relay-proxy.service.ts

- `resolveRequestedModelConfigs`: 新增方法，返回所有匹配模型ID的配置
- `resolveChannelModelConfig`: 新增方法，根据渠道的allowedModels选择对应的模型配置
- `validateChannelModelConfig`: 新增方法，验证渠道是否有可用的模型配置
- `ensureChannelAllowsModel`: 使用 `isModelNameAllowed` 检查模型名称
- `ensureTokenAllowsModel`: 使用 `isModelNameAllowed` 检查模型名称
- `getAvailableModelsForToken`: 使用 `isModelNameAllowed` 过滤模型
- **主要变更**: 在渠道循环内为每个渠道选择对应的模型配置，而不是全局选择一个

#### 2. relay-model-availability.util.ts

- `parseRelayChannelAllowedModelNames`: 返回模型名称（不是模型ID）
- `getAccessibleRelayModelConfigsForToken`: 使用 `isModelNameAllowed` 过滤

#### 3. 测试文件

- `relay-failover-charging.integration.test.ts`: allowedModels 使用 `testModel` 而不是 `testModelId`
- `model-resolution.test.ts`: 新增单元测试
- `model-id-channel-resolution.integration.test.ts`: 新增集成测试

### 前端修改（待实现）

#### 1. ModelPricingTable.vue

- 显示模型ID为主要信息
- 模型名称作为次要信息（灰色小字）

#### 2. 渠道/令牌管理页面

- 选择模型时显示：模型ID（模型名称）
- 保存时存储模型名称到 allowedModels

## 测试验证

### 单元测试

- ✅ `isModelNameAllowed` 函数测试
- ✅ `parseRelayChannelAllowedModelNames` 函数测试
- ✅ `getAccessibleRelayModelConfigsForToken` 函数测试

### 集成测试

- ✅ 客户端使用模型ID请求
- ✅ 渠道限制检查（模型名称）
- ✅ 令牌限制检查（模型名称）
- ✅ 多渠道模型去重
- ✅ 可用模型列表返回模型ID

## 数据迁移

**无需迁移！**

现有数据已经存储的是模型名称，符合新的设计方案。

## 注意事项

1. **模型名称必须唯一**：因为 allowedModels 存储的是模型名称
2. **模型ID可以重复**：多个模型可以有相同的 provider（不推荐）
3. **删除模型**：删除模型前检查是否有渠道/令牌引用
4. **修改模型名称**：需要同步更新所有引用该模型名称的 allowedModels
