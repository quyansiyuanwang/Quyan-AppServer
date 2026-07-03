# 日志系统增强功能

本文档介绍了日志系统的三个新增功能：

## 1. 请求内容模糊搜索

### 功能说明

在 API 日志查询中添加了全文模糊搜索功能，可以同时搜索多个字段：

- `path` - 请求路径
- `requestID` - 请求 ID
- `ipAddress` - IP 地址
- `queryParams` - 查询参数（JSON 字段）
- `bodyParams` - 请求体参数（JSON 字段）

### 使用方法

#### 后端 API

在 `/system/logs` 接口中添加 `search` 查询参数：

```typescript
GET /system/logs?search=关键词&page=1&pageSize=10
```

#### 代码示例

```typescript
// APILogRepository
const result = await apiLogRepo.query({
  search: "user123", // 搜索包含 "user123" 的所有日志
  limit: 10,
  offset: 0,
});
```

### 实现细节

- 使用 Prisma 的 `OR` 条件组合多个字段搜索
- JSON 字段使用 `string_contains` 进行搜索（MySQL JSON_SEARCH）
- 搜索是模糊匹配，不区分大小写（取决于数据库配置）

---

## 2. Logger 路由层装饰器

### 功能说明

提供 `@LogRoute` 装饰器，用于自动记录 Controller 方法的请求和响应信息。

### 使用方法

#### 基础用法

```typescript
import { LogRoute } from "@/util/logger-decorator";

@Route("users")
export class UserController {
  @Get("{userId}")
  @Security("jwt")
  @LogRoute() // 默认记录请求信息
  public async getUser(@Path() userId: string) {
    // ...
  }
}
```

#### 高级配置

```typescript
@LogRoute({
  message: "获取用户信息",        // 自定义日志消息
  category: LogCategory.BUSINESS, // 日志类别
  logRequest: true,               // 记录请求参数（默认 true）
  logResponse: true,              // 记录响应数据（默认 false）
  level: "info",                  // 日志级别（info/debug/warn/error）
})
public async getUser(@Path() userId: string) {
  // ...
}
```

### 装饰器选项

| 选项          | 类型          | 默认值    | 说明             |
| ------------- | ------------- | --------- | ---------------- |
| `message`     | `string`      | 方法名    | 自定义日志消息   |
| `category`    | `LogCategory` | `REQUEST` | 日志类别         |
| `logRequest`  | `boolean`     | `true`    | 是否记录请求参数 |
| `logResponse` | `boolean`     | `false`   | 是否记录响应数据 |
| `level`       | `string`      | `"info"`  | 日志级别         |

### 日志输出示例

```
2026-03-11 10:30:45 [INFO][REQUEST] SystemController.getSystemStats: 请求 getSystemStats {
  method: "GET",
  url: "/system/stats",
  params: {}
}

2026-03-11 10:30:45 [INFO][REQUEST] SystemController.getSystemStats: 获取系统统计信息 完成 {
  duration: "125ms",
  response: "{\"uptime\":12345,\"memory\":{...}}... [截断，原长度: 850]"
}
```

### 特性

- **自动截断长内容**：请求和响应数据会自动截断，防止日志过大
- **性能监控**：自动记录方法执行时间
- **错误捕获**：自动记录方法执行失败的错误信息
- **灵活配置**：可以选择性记录请求/响应

---

## 3. Log 长内容截断

### 功能说明

在 `logger.ts` 中添加了自动截断功能，防止日志内容过大导致性能问题或存储浪费。

### 配置

```typescript
// src/util/logger.ts
export const LOG_TRUNCATE_CONFIG = {
  maxFieldLength: 1000, // 单个字段最大长度
  maxContextLength: 5000, // 整个 context 对象最大长度
  enabled: true, // 是否启用截断
};
```

### 截断规则

#### 1. 字符串截断

```typescript
logger.info("用户数据", {
  data: "很长的字符串...",
});

// 输出：
// data: "很长的字符串...[截断,原长:5000]"
```

#### 2. 数组截断

```typescript
logger.info("用户列表", {
  users: [
    /* 100 个用户 */
  ],
});

// 输出：
// users: "[Array(100) - 仅显示前10项: [...]]"
```

#### 3. 对象截断

```typescript
logger.info("复杂对象", {
  data: {
    /* 嵌套很深的对象 */
  },
});

// 输出：
// data: {
//   _truncated: true,
//   _originalSize: 10000,
//   _summary: "Context 过大已截断 (10000 chars)",
//   _preview: "前 5000 个字符..."
// }
```

### 独立截断工具

如果需要在其他地方使用截断功能：

```typescript
import { truncateContent } from "@/util/logger-decorator";

const truncated = truncateContent(largeObject, 500);
console.log(truncated);
```

### 使用场景

- **API 日志**：防止大型响应体占用过多存储空间
- **错误日志**：截断长错误堆栈信息
- **调试日志**：在开发环境中记录大型对象时自动截断
- **性能优化**：减少日志序列化和写入时间

---

## 完整示例

### Controller 示例

```typescript
import { Controller, Get, Route, Security, Query } from "@tsoa/runtime";
import { LogRoute } from "@/util/logger-decorator";
import { LogCategory } from "@/util/logger";

@Route("example")
export class ExampleController extends Controller {
  // 简单用法：只记录请求
  @Get("simple")
  @Security("jwt")
  @LogRoute()
  public async simpleMethod() {
    return { message: "success" };
  }

  // 完整用法：记录请求和响应
  @Get("detailed")
  @Security("jwt")
  @LogRoute({
    message: "详细日志示例",
    category: LogCategory.BUSINESS,
    logRequest: true,
    logResponse: true,
    level: "debug",
  })
  public async detailedMethod(@Query() keyword: string) {
    // 业务逻辑
    return { data: "large response..." };
  }
}
```

### 日志查询示例

```typescript
// 前端调用
const response = await axios.get("/system/logs", {
  params: {
    search: "user123", // 模糊搜索
    page: 1,
    pageSize: 20,
    startDate: "2026-03-01",
    endDate: "2026-03-11",
  },
});
```

---

## 注意事项

1. **性能影响**：
   - `@LogRoute` 装饰器会增加少量性能开销（通常 < 5ms）
   - 建议只在关键接口或需要审计的接口上使用
   - 避免在高频接口（如心跳检测）上使用 `logResponse: true`

2. **存储空间**：
   - 即使有截断功能，日志仍会占用存储空间
   - 建议定期清理旧日志（使用 `APILogRepository.deleteOldLogs()`）
   - 生产环境建议保留 30-90 天日志

3. **敏感信息**：
   - 截断功能不会过滤敏感信息
   - 敏感字段过滤由 `LogService.filterSensitiveData()` 处理
   - 确保在 `config/logging.ts` 中配置所有敏感字段

4. **JSON 字段搜索**：
   - `string_contains` 在 MySQL 中使用 `JSON_SEARCH` 函数
   - 性能可能不如普通字段搜索
   - 建议配合时间范围过滤使用

---

## 相关文件

- `src/util/logger-decorator.ts` - Logger 装饰器实现
- `src/util/logger.ts` - Logger 工具和截断功能
- `src/store/apilog.ts` - API 日志仓库（模糊搜索）
- `src/config/logging.ts` - 日志配置
- `src/api/controllers/system/system.controller.ts` - 使用示例
