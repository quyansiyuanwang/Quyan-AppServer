# 日志增强功能 - 快速参考

## 🔍 1. 模糊搜索 API 日志

### API 调用

```bash
# 搜索包含关键词的所有日志
GET /system/logs?search=关键词

# 组合搜索（搜索 + 时间范围）
GET /system/logs?search=error&startDate=2026-03-01&endDate=2026-03-11

# 组合搜索（搜索 + 方法过滤）
GET /system/logs?search=user&method=POST&method=PUT
```

### 代码调用

```typescript
import { APILogRepository } from "@/store/apilog";

const apiLogRepo = APILogRepository.getInstance();

// 基础搜索
const result = await apiLogRepo.query({
  search: "关键词",
  limit: 20,
});

// 组合搜索
const result = await apiLogRepo.query({
  search: "error",
  startDate: new Date("2026-03-01"),
  endDate: new Date("2026-03-11"),
  method: ["POST", "PUT"],
  limit: 50,
});
```

### 搜索范围

- ✅ `path` - 请求路径
- ✅ `requestID` - 请求 ID
- ✅ `ipAddress` - IP 地址
- ✅ `queryParams` - 查询参数（JSON）
- ✅ `bodyParams` - 请求体（JSON）

---

## 📝 2. Logger 装饰器

### 基础用法

```typescript
import { LogRoute } from "@/util/logger-decorator";

@Get("users")
@Security("jwt")
@LogRoute()  // 默认记录请求
public async getUsers() {
  return users;
}
```

### 完整配置

```typescript
@LogRoute({
  message: "获取用户列表",           // 自定义消息
  category: LogCategory.BUSINESS,   // 日志类别
  logRequest: true,                 // 记录请求（默认 true）
  logResponse: true,                // 记录响应（默认 false）
  level: "info",                    // 日志级别
})
```

### 常用配置组合

#### 安全审计（只记录请求）

```typescript
@LogRoute({
  message: "用户登录",
  category: LogCategory.AUTH,
  logRequest: true,
  logResponse: false,  // 不记录响应（包含 token）
})
```

#### 调试模式（记录所有）

```typescript
@LogRoute({
  message: "调试接口",
  level: "debug",
  logRequest: true,
  logResponse: true,
})
```

#### 性能监控（只记录时间）

```typescript
@LogRoute({
  message: "批量处理",
  logRequest: false,
  logResponse: false,  // 只记录执行时间
})
```

---

## ✂️ 3. 内容截断

### 自动截断（无需配置）

```typescript
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("MyService", LogCategory.BUSINESS);

// 自动截断长内容
logger.info("处理数据", {
  data: veryLargeObject, // 自动截断
});
```

### 手动截断

```typescript
import { truncateContent } from "@/util/logger-decorator";

// 截断到 500 字符
const truncated = truncateContent(largeData, 500);
logger.info("数据", { data: truncated });
```

### 配置截断规则

```typescript
import { LOG_TRUNCATE_CONFIG } from "@/util/logger";

// 修改配置（在应用启动时）
LOG_TRUNCATE_CONFIG.maxFieldLength = 2000; // 单个字段
LOG_TRUNCATE_CONFIG.maxContextLength = 10000; // 整体大小
LOG_TRUNCATE_CONFIG.enabled = true; // 启用/禁用

// 临时禁用（调试时）
LOG_TRUNCATE_CONFIG.enabled = false;
// ... 调试代码 ...
LOG_TRUNCATE_CONFIG.enabled = true;
```

---

## 🎯 使用场景速查

| 场景         | 推荐方案            | 示例                                               |
| ------------ | ------------------- | -------------------------------------------------- |
| 查找错误日志 | 模糊搜索            | `search=error`                                     |
| 查找用户操作 | 模糊搜索 + 用户过滤 | `user=john&search=delete`                          |
| 审计登录操作 | Logger 装饰器       | `@LogRoute({ logRequest: true })`                  |
| 调试复杂接口 | Logger 装饰器       | `@LogRoute({ logResponse: true, level: "debug" })` |
| 记录大型数据 | 自动截断            | 无需配置，自动生效                                 |
| 查看完整日志 | 禁用截断            | `LOG_TRUNCATE_CONFIG.enabled = false`              |

---

## ⚡ 性能建议

### ✅ 推荐做法

- 模糊搜索配合时间范围使用
- 只在关键接口使用 `@LogRoute`
- 高频接口避免 `logResponse: true`
- 定期清理旧日志（30-90天）

### ❌ 避免做法

- 不要在心跳检测接口使用装饰器
- 不要在生产环境禁用截断
- 不要进行无时间范围的全表搜索
- 不要在循环中频繁记录大对象

---

## 🔧 故障排查

### 搜索没有结果？

1. 检查时间范围（默认只搜索最近 30 天）
2. 检查关键词是否正确
3. 尝试更短的关键词

### 装饰器不生效？

1. 确保导入了 `@LogRoute`
2. 检查装饰器顺序（应在 `@Get/@Post` 之后）
3. 查看控制台是否有错误

### 日志被截断太多？

1. 增加 `maxFieldLength` 配置
2. 临时禁用截断查看完整数据
3. 使用 `truncateContent()` 自定义截断长度

---

## 📚 更多文档

- [详细使用文档](./logging-enhancements.md)
- [完整代码示例](./logging-examples.ts)
- [实现总结](./LOGGING_ENHANCEMENTS_README.md)
