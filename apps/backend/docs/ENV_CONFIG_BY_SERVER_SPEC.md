# 环境变量配置指南 - 针对不同服务器规格

## 新的资源保护机制

代码已经实现了智能的资源保护机制，可以通过环境变量针对**图片请求**单独设置限制：

```typescript
// 图片请求会进入独立的 image 并发作用域
const maxConcurrency = isImageRequest
  ? Math.min(relayConfig.maxConcurrency, resourceGuard.imageMaxConcurrency)
  : relayConfig.maxConcurrency;
```

这意味着：

- **默认/文本请求**（如纯文本 `chat/completions`、普通 `/responses`）: 使用 `maxConcurrency` 配置
- **图片请求**（如 `images/generations`、`images/edits`、带 `image_generation` 工具的 `/responses`，以及携带图片内容的 OpenAI / Anthropic / Gemini 多模态请求）: 使用 `min(maxConcurrency, imageMaxConcurrency)`
- 两类请求使用**不同的并发计数键**，图片请求不会再占用文本请求的并发槽位

## 环境变量说明

### 图片请求专用限制

| 环境变量                        | 默认值 | 范围     | 说明                                  |
| ------------------------------- | ------ | -------- | ------------------------------------- |
| `RELAY_IMAGE_MAX_CONCURRENCY`   | 1      | 1-10     | 图片请求的最大并发数                  |
| `RELAY_IMAGE_QUEUE_TIMEOUT_MS`  | 300000 | 0-300000 | 图片请求的队列超时（毫秒，默认5分钟） |
| `RELAY_MULTIPART_BODY_LIMIT_MB` | 8      | 1-20     | multipart 请求体大小限制（MB）        |

### 通用限制

| 环境变量                               | 默认值 | 范围         | 说明                     |
| -------------------------------------- | ------ | ------------ | ------------------------ |
| `RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS` | 600000 | 10000-600000 | 非流式请求超时（毫秒）   |
| `RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB`  | 64     | 1-128        | 上游响应体大小限制（MB） |

## 推荐配置

### 2v2g (2核2GB内存) - 当前配置

创建 `.env` 文件或在启动脚本中设置：

```bash
# 图片请求限制（关键！）
RELAY_IMAGE_MAX_CONCURRENCY=1          # image 作用域同时只处理 1 个图片请求
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000    # 图片请求最多等待5分钟
RELAY_MULTIPART_BODY_LIMIT_MB=8        # 限制图片大小到8MB

# 通用限制
RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS=600000    # 10分钟超时
RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB=32         # 限制响应体到32MB
```

**数据库配置** (通过 `relay-config` API 或数据库):

```json
{
  "maxConcurrency": 5, // default/文本作用域可以有5个并发
  "queueTimeout": 300000,
  "enableQueue": true
}
```

**效果**:

- **文本请求**: 最多5个并发（快速响应）
- **图片请求**: 最多1个并发（防止卡死）
- 3个用户同时发图片请求: 第1个立即处理，第2、3个排队等待

---

### 2v4g (2核4GB内存) - 推荐配置

```bash
# 图片请求限制
RELAY_IMAGE_MAX_CONCURRENCY=2          # image 作用域可以同时处理 2 个图片请求
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000
RELAY_MULTIPART_BODY_LIMIT_MB=12       # 支持更大的图片

# 通用限制
RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS=600000
RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB=64
```

**数据库配置**:

```json
{
  "maxConcurrency": 6, // default/文本作用域可以有6个并发
  "queueTimeout": 300000,
  "enableQueue": true
}
```

**效果**:

- **文本请求**: 最多6个并发
- **图片请求**: 最多2个并发
- 5个用户同时发图片请求: 前2个立即处理，后3个排队

---

### 2v8g (2核8GB内存) - 推荐配置

```bash
# 图片请求限制
RELAY_IMAGE_MAX_CONCURRENCY=3          # image 作用域可以同时处理 3 个图片请求
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000
RELAY_MULTIPART_BODY_LIMIT_MB=20       # 支持大图片

# 通用限制
RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS=600000
RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB=128
```

**数据库配置**:

```json
{
  "maxConcurrency": 8, // default/文本作用域可以有8个并发
  "queueTimeout": 300000,
  "enableQueue": true
}
```

**效果**:

- **文本请求**: 最多8个并发
- **图片请求**: 最多3个并发
- 10个用户同时发图片请求: 前3个立即处理，后7个排队

---

## 配置示例

### 方式1: 通过 .env 文件

在 `NodeBackend/.env` 中添加：

```bash
# 2v2g 服务器配置
RELAY_IMAGE_MAX_CONCURRENCY=1
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000
RELAY_MULTIPART_BODY_LIMIT_MB=8
RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS=600000
RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB=32
```

### 方式2: 通过 PM2 配置

在 `ecosystem.config.js` 中：

```javascript
module.exports = {
  apps: [
    {
      name: "appserver",
      script: "./dist/index.cjs",
      env: {
        NODE_ENV: "production",
        RELAY_IMAGE_MAX_CONCURRENCY: 1,
        RELAY_IMAGE_QUEUE_TIMEOUT_MS: 300000,
        RELAY_MULTIPART_BODY_LIMIT_MB: 8,
        RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS: 600000,
        RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB: 32,
      },
    },
  ],
};
```

### 方式3: 通过 systemd 服务

在 `/etc/systemd/system/appserver.service` 中：

```ini
[Service]
Environment="RELAY_IMAGE_MAX_CONCURRENCY=1"
Environment="RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000"
Environment="RELAY_MULTIPART_BODY_LIMIT_MB=8"
```

### 方式4: 通过 Docker

在 `docker-compose.yml` 中：

```yaml
services:
  appserver:
    environment:
      - RELAY_IMAGE_MAX_CONCURRENCY=1
      - RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000
      - RELAY_MULTIPART_BODY_LIMIT_MB=8
```

---

## 动态调整数据库配置

### 通过 API 调整

```bash
# 获取当前配置
curl http://your-server/relay-config \
  -H "Authorization: Bearer YOUR_TOKEN"

# 更新配置
curl -X PUT http://your-server/relay-config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxConcurrency": 5,
    "queueTimeout": 300000,
    "enableQueue": true
  }'
```

### 通过数据库直接修改

```sql
-- 查看当前配置
SELECT * FROM RelayConfig;

-- 更新配置
UPDATE RelayConfig
SET maxConcurrency = 5,
    queueTimeout = 300000
WHERE id = 'your-config-id';
```

---

## 性能对比

### 场景: 10个用户同时请求（5个文本 + 5个图片）

| 配置 | 文本并发 | 图片并发 | 文本等待 | 图片等待 | 总内存 |
| ---- | -------- | -------- | -------- | -------- | ------ |
| 2v2g | 5        | 1        | 0个排队  | 4个排队  | ~1GB   |
| 2v4g | 6        | 2        | 0个排队  | 3个排队  | ~2GB   |
| 2v8g | 8        | 3        | 0个排队  | 2个排队  | ~3GB   |

### 场景: 3个用户同时发图片请求

| 配置 | 立即处理 | 排队等待 | 平均等待时间 |
| ---- | -------- | -------- | ------------ |
| 2v2g | 1个      | 2个      | 10-20秒      |
| 2v4g | 2个      | 1个      | 5-10秒       |
| 2v8g | 3个      | 0个      | 0秒          |

---

## 监控和调优

### 检查当前配置

```bash
# 检查环境变量
env | grep RELAY_

# 检查数据库配置
curl http://your-server/relay-config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 监控队列长度

```bash
# 推荐：查看汇总并发状态
curl http://your-server/relay-config/concurrency-status \
  -H "Authorization: Bearer YOUR_TOKEN"

# 查看单个用户
curl "http://your-server/relay-config/concurrency-status?userId=USER_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 如需直接查看 Redis，请使用分作用域键
redis-cli get "relay:concurrency:default:USER_ID"
redis-cli get "relay:concurrency:image:USER_ID"
```

### 性能指标

关注这些指标来调整配置：

1. **图片请求 429 错误率**
   - 如果 > 5%: 提高 `RELAY_IMAGE_MAX_CONCURRENCY`
   - 或提高 `RELAY_IMAGE_QUEUE_TIMEOUT_MS`

2. **CPU 使用率**
   - 如果持续 > 90%: 降低 `RELAY_IMAGE_MAX_CONCURRENCY`

3. **内存使用率**
   - 如果 > 80%: 降低 `RELAY_MULTIPART_BODY_LIMIT_MB`

4. **平均响应时间**
   - 图片请求 > 30秒: 提高并发或优化上游 API

---

## 常见问题

### Q: 为什么图片请求要单独限制？

**A**: 图片请求的特点：

- 请求体大（4-20MB）
- 处理时间长（5-30秒）
- CPU 密集（base64 编码/解码）
- 内存占用高

如果不单独限制，大量图片请求会导致：

- 服务器卡死
- 文本请求也无法处理
- 整体服务不可用

### Q: 如果 3 个用户同时发图片请求会怎样？

**A**: 以 2v2g 配置为例（`RELAY_IMAGE_MAX_CONCURRENCY=1`）：

```
用户1: [立即处理] ──> 10秒后完成
用户2: [排队等待] ──> 用户1完成后开始 ──> 10秒后完成
用户3: [排队等待] ──> 用户2完成后开始 ──> 10秒后完成

总耗时: 30秒
```

**不会失败**，除非等待超过 `RELAY_IMAGE_QUEUE_TIMEOUT_MS`（默认5分钟）

### Q: 文本请求会受图片请求影响吗？

**A**: 不会！这就是分离限制的优势：

```
文本请求: maxConcurrency = 5 (快速处理)
图片请求: imageMaxConcurrency = 1 (防止卡死)
```

即使有10个图片请求在排队，文本请求仍然可以正常处理。

### Q: 如何知道当前有多少图片请求在排队？

**A**: 现在优先使用新的并发状态接口：

```bash
GET /relay-config/concurrency-status
GET /relay-config/concurrency-status?userId=USER_ID
```

返回中会区分：

- `scope = default | image`
- `source = local | redis`
- `activeCount`、`queueLength`、`ttlSeconds`

如果需要直接查看 Redis，也要注意现在使用的是**分作用域键**：

```bash
# 查看特定用户的默认/文本并发
redis-cli get "relay:concurrency:default:USER_ID"

# 查看特定用户的图片并发
redis-cli get "relay:concurrency:image:USER_ID"
```

---

## 升级建议

### 当前问题: 图片请求经常排队

**诊断**:

```bash
# 检查 429 错误率
grep "429" logs/access.log | wc -l

# 检查平均等待时间
# 如果 > 30秒，需要升级
```

**解决方案**:

1. **短期**: 提高 `RELAY_IMAGE_MAX_CONCURRENCY` 到 2
2. **中期**: 升级到 2v4g
3. **长期**: 升级到 4v4g（CPU 翻倍）

### 升级路径

| 当前 | 升级到 | 图片并发提升 | 成本增加     | 推荐场景 |
| ---- | ------ | ------------ | ------------ | -------- |
| 2v2g | 2v4g   | 1→2 (100%)   | 内存翻倍     | 小团队   |
| 2v2g | 4v4g   | 1→4 (300%)   | CPU+内存翻倍 | 多用户   |
| 2v4g | 4v8g   | 2→6 (200%)   | CPU+内存翻倍 | 高并发   |

---

## 总结

### 关键配置

1. **2v2g**: `RELAY_IMAGE_MAX_CONCURRENCY=1` - 防止卡死
2. **2v4g**: `RELAY_IMAGE_MAX_CONCURRENCY=2` - 平衡性能
3. **2v8g**: `RELAY_IMAGE_MAX_CONCURRENCY=3` - 充分利用内存

### 最佳实践

1. **分离限制**: 图片和文本请求使用不同的并发限制
2. **启用队列**: `enableQueue: true` 防止请求失败
3. **监控指标**: 关注 CPU、内存、429 错误率
4. **动态调整**: 根据实际负载调整配置

### 记住

- **请求不会失败**，只会排队等待
- **CPU 是瓶颈**，不是内存（如果有 400MB+ 可用）
- **图片请求**需要单独限制，否则会影响整体服务
- **/responses + image_generation**、OpenAI `chat/completions` / `responses` 图片内容、Anthropic `image` block、Gemini 图片 `inlineData` / `fileData` 都按图片请求处理，不再与普通文本共享并发计数

---

## 日志与诊断

### 日志位置

生产环境的 `logger.info()` **不会显示在 `pm2 logs` 中**（PM2 控制台只输出 ERROR 级别）。

图片请求日志需要查看文件：

```bash
# 实时监控图片请求
tail -f logs/combined-$(date +%Y-%m-%d).log | grep "Image request"

# 或使用监控脚本 (带颜色高亮)
./scripts/monitor-logs.sh

# 运行分析脚本
./scripts/analyze-image-requests.sh logs/combined-$(date +%Y-%m-%d).log
```

### 日志级别

| 级别  | PM2 控制台 | 文件日志 | 说明                       |
| ----- | ---------- | -------- | -------------------------- |
| ERROR | ✅         | ✅       | 错误信息                   |
| WARN  | ❌         | ✅       | 警告信息                   |
| INFO  | ❌         | ✅       | 图片请求日志在这里         |
| HTTP  | ❌         | ✅       | HTTP 请求日志              |
| DEBUG | ❌         | ❌       | 调试信息（生产环境不输出） |

**前提**: `.env` 中必须设置 `ENABLE_FILE_LOGGING=true`。

### 图片请求日志内容

系统会自动记录：

1. **请求接收** — 模型、大小、用户、IP
2. **并发控制** — 当前并发数、最大并发数
3. **队列等待** — 进入排队、等待时长
4. **请求完成** — 总处理耗时
5. **超时警告** — 队列等待超时

### 服务器卡死后的诊断步骤

```bash
# 1. 查看卡死前的最后几个图片请求
grep "Image request received" logs/combined-$(date +%Y-%m-%d).log | tail -10

# 2. 查看是否有超大请求 (>10MB)
grep "Image request received" logs/combined-$(date +%Y-%m-%d).log | \
  grep -E "requestSizeMB.*[1-9][0-9]+"

# 3. 运行分析脚本，查看统计和诊断建议
./scripts/analyze-image-requests.sh logs/combined-$(date +%Y-%m-%d).log
```
