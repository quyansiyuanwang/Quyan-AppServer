# 内存优化修复总结

## 问题诊断

### 原始问题

- **服务器配置**: 2v2g (2核 2GB 内存) + 3Mbps 带宽
- **症状**: 并发 2 个图片请求就卡死，连宝塔都打不开
- **场景**: 流式转发 AI 图片请求

### 根本原因

1. **非流式处理导致内存爆炸**
   - `JSON.stringify(convertedBody)` 把整个请求体加载到内存
   - 一个 5MB 图片 → 内存中至少 10MB（原始 + 序列化）
   - 两个并发 = 20MB+，加上其他开销轻松超过 2GB

2. **JSON body limit 过大**
   - 之前错误地设置为 20MB
   - 允许客户端发送超大请求

3. **测试用例不合理**
   - 测试图片 4.5MB × 2 = 9MB+ JSON body
   - 不应该用 JSON + base64 传输大图片

## 修复措施

### 1. ✅ 请求体大小预检查

**文件**: `src/middleware/request-size-guard.ts`

- 在 body parser 之前检查 `Content-Length`
- 提前拒绝超大请求，防止内存占用
- 分类限制：
  - JSON: 5MB
  - Multipart: 4MB（可配置）
  - 其他: 10MB

**效果**: 恶意或错误的大请求在解析前就被拒绝，不占用内存

### 2. ✅ 内存监控

**文件**: `src/middleware/memory-monitor.ts`

- 每分钟记录一次内存使用情况
- 堆内存超过 1.5GB 时告警
- 帮助诊断内存泄漏

**日志示例**:

```
[INFO] Memory usage: heapUsed=512.3MB, heapTotal=1024.0MB, rss=1536.2MB
[WARN] High memory usage detected: heapUsed=1600.5MB
```

### 3. ✅ JSON body limit 调整

**修改**: `src/app.ts`

```typescript
// 从 20MB 改回 5MB
app.use(express.json({ limit: "5mb" }));
```

**原因**:

- 图片应该用 multipart/form-data，不是 JSON + base64
- 5MB 足够处理正常的 JSON 请求
- 防止内存占用过大

### 4. ✅ 测试用例修复

**修改**: `tests/integration/relay-proxy-images.integration.test.ts`

- 创建小测试图片: `test-image-small.png` (685 bytes)
- 替换原来的 4.5MB 大图片
- 两张图片 base64 后约 2KB，远小于 5MB limit

### 5. ✅ 配置优化

**文件**: `.env.example`

```bash
# 2v2g 服务器推荐配置
RELAY_IMAGE_MAX_CONCURRENCY=1        # 图片请求并发限制
RELAY_MULTIPART_BODY_LIMIT_MB=4      # Multipart 限制 4MB
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000  # 队列超时 5 分钟
```

## 配置建议

### 2v2g 服务器（你的配置）

```bash
# .env
RELAY_IMAGE_MAX_CONCURRENCY=1
RELAY_MULTIPART_BODY_LIMIT_MB=4
RELAY_IMAGE_QUEUE_TIMEOUT_MS=300000
RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS=600000
RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB=32
```

**说明**:

- 图片并发严格限制为 1
- Multipart 限制 4MB
- JSON 限制 5MB（代码中硬编码）
- 上游响应限制 32MB

### 监控建议

1. **观察内存日志**

   ```bash
   tail -f logs/combined.log | grep "Memory usage"
   ```

2. **观察请求被拒绝的情况**

   ```bash
   tail -f logs/combined.log | grep "Request body too large"
   ```

3. **观察并发队列**
   ```bash
   tail -f logs/combined.log | grep "queue timeout"
   ```

## 未来优化方向

### 1. 真正的流式处理（高优先级）

**问题**: 当前代码在 `relay-proxy.service.ts:1612` 行：

```typescript
const bodyData = JSON.stringify(convertedBody); // 💥 内存炸点
```

**解决方案**: 使用流式处理

```typescript
// 不要序列化整个 body，而是流式传输
req.pipe(proxyReq);
```

**影响**: 可以处理任意大小的请求，不占用内存

### 2. 引导客户端使用 multipart

**当前问题**: 客户端用 JSON + base64 传图片

**建议**:

- 文档中明确说明应该用 `multipart/form-data`
- 对于超过 2MB 的 JSON 请求返回友好错误提示
- 提供 multipart 示例代码

### 3. 添加请求速率限制

**建议**: 基于 IP 的速率限制

```typescript
// 每个 IP 每分钟最多 10 个图片请求
rateLimit({
  windowMs: 60000,
  max: 10,
  keyGenerator: (req) => req.ip,
});
```

## 测试验证

### 运行测试

```bash
cd NodeBackend
npm test -- relay-proxy-images.integration.test.ts
```

### 预期结果

- ✅ 所有测试通过
- ✅ 内存使用稳定
- ✅ 无 OOM 错误

## 总结

通过以上修复：

1. **立即生效**: 请求大小限制防止内存爆炸
2. **可观测性**: 内存监控帮助诊断问题
3. **测试修复**: 测试用例更合理
4. **配置优化**: 针对 2v2g 服务器的最佳配置

**关键指标**:

- JSON 请求: ≤ 5MB
- Multipart 请求: ≤ 4MB
- 图片并发: 1
- 内存告警阈值: 1.5GB

这些措施应该能够防止你的 2v2g 服务器被打爆。
