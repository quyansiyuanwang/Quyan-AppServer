# API 客户端文档

**文档版本**: v1
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444
**文档日期**: 2026/2/10

## 概述

本项目使用 OpenAPI 规范自动生成类型安全的 API 客户端，确保前后端接口的一致性和类型安全。

## OpenAPI 客户端生成流程

### 1. 生成命令

```bash
pnpm run openapi:generate
```

**执行流程**:

```
1. openapi-ts 从后端获取 OpenAPI 规范
   ↓ (http://localhost:10001/docs/openapi.json)
2. 生成 TypeScript 类型和客户端代码到 src/client/
   ↓
3. 运行 scripts/generate-api-constants.js
   → 生成 api-endpoints.gen.ts (API 端点元数据)
   ↓
4. 运行 scripts/generate-api-types-map.js
   → 生成 api-types-map.gen.ts (请求/响应类型映射)
   ↓
5. 运行 lint-format-check (代码检查和格式化)
```

### 2. 生成的文件

**src/client/** 目录（自动生成，禁止手动编辑）:

| 文件                   | 说明                                         |
| ---------------------- | -------------------------------------------- |
| `types.gen.ts`         | 从 OpenAPI schema 生成的 TypeScript 类型定义 |
| `api-endpoints.gen.ts` | API 端点 URL 和元数据                        |
| `api-types-map.gen.ts` | 请求/响应类型映射表                          |

### 3. OpenAPI 配置

配置文件位于项目根目录的 `openapi-ts.config.ts` 或 `package.json` 中。

**关键配置**:

- **输入**: `http://localhost:10001/docs/openapi.json`
- **输出**: `src/client/`
- **客户端**: 不生成客户端代码（使用自定义 Axios 封装）
- **类型**: 生成 TypeScript 类型定义

## API 客户端使用

### 1. 基本使用模式

```typescript
import { useRequestStore } from '@/stores/request'
import { API_ENDPOINTS } from '@/client/api-endpoints.gen'
import type { LoginApiType } from '@/client/api-types-map.gen'

// 获取 Axios 实例
const request = useRequestStore().getAxios()

// 发送请求（完全类型安全）
const result = await request.post<LoginApiType>(API_ENDPOINTS.Login.url, { username, password })

// result 的类型自动推断为 LoginApiType['response']
```

### 2. API 端点元数据

**api-endpoints.gen.ts** 提供所有 API 端点的元数据:

```typescript
export const API_ENDPOINTS = {
  Login: {
    url: '/auth/login',
    method: 'POST',
    description: '用户登录',
  },
  GetAllPermissions: {
    url: '/permissions',
    method: 'GET',
    description: '获取所有权限',
  },
  // ... 更多端点
}

// 动态 URL 构建函数
export const buildGetUserPermissionsUrl = (userId: string) => `/users/${userId}/permissions`
```

### 3. 类型映射

**api-types-map.gen.ts** 定义每个 API 的类型结构:

```typescript
export interface LoginApiType {
  body: {
    username: string
    password: string
  }
  response: {
    code: number
    data: {
      access_token: string
      refresh_token: string
    }
  }
  query?: undefined
}
```

### 4. 在服务层使用

**推荐模式**: 在服务层封装 API 调用

```typescript
// service/authorizationService.ts
export class AuthorizationService {
  async login(username: string, password: string) {
    const request = useRequestStore().getAxios()
    const result = await request.post<LoginApiType>(API_ENDPOINTS.Login.url, { username, password })

    if (result.code === CustomCode.OK && result.data) {
      // 处理成功响应
      localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, result.data.access_token)
      localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, result.data.refresh_token)
    }

    return result
  }
}
```

## 自定义 Axios 封装

### 1. MyAxios 类

位于 `stores/request.ts`，提供增强的 Axios 功能:

**核心特性**:

- JWT token 自动注入
- Token 过期自动刷新
- 401 响应自动重试
- 请求/响应拦截器
- 进度条集成

### 2. 请求方法

```typescript
class MyAxios {
  // POST 请求
  async post<UnionModel extends ApiTypeInfo>(
    url: string,
    data?: UnionModel['body'],
    options?: RequestOptions,
  ): PromDeResp<UnionModel['response']>

  // GET 请求
  async get<UnionModel extends ApiTypeInfo>(
    url: string,
    params?: UnionModel['query'],
    options?: RequestOptions,
  ): PromDeResp<UnionModel['response']>
}
```

### 3. 请求选项

```typescript
interface RequestOptions {
  retry?: boolean // 是否在 401 时重试（默认 true）
  requestWrapper?: <T>(promise: Promise<T>) => Promise<T> // 请求包装器
}
```

**使用示例**:

```typescript
// 禁用重试（用于 refresh token 请求）
await request.post<RefreshApiType>(API_ENDPOINTS.Refresh.url, { refresh_token }, { retry: false })
```

## 请求拦截器

### 1. 请求拦截器逻辑

```typescript
// 1. 检查是否需要跳过 token 处理
const isSkipRetry = config.headers?.[OPTION_KEYS.SKIP_RETRY] === 'true'
const isExcluded = EXCLUDED_URLS.includes(config.url || '')

// 2. 检查 token 是否过期（3秒缓冲期）
const needsRefresh = MyAxios.refreshTokenPromise || isTokenExpired(2)

// 3. 如果需要刷新，等待刷新完成
if (needsRefresh) {
  const newToken = await MyAxios.getRefreshPromise()
  config.headers.setAuthorization(`Bearer ${newToken}`)
}

// 4. 注入 access token
config.headers.setAuthorization(`Bearer ${accessToken}`)
```

### 2. 响应拦截器逻辑

```typescript
// 成功响应
;(response) => {
  // 1. 检查自定义响应码
  const codeMsg = getCustomCodeText(response.data?.code)
  if (codeMsg) customCodeBus.emit(codeMsg, response.data)

  // 2. 检查 HTTP 状态码
  const statusMsg = getHttpStatusText(response.status)
  if (statusMsg) webEventBus.emit(statusMsg, response)

  // 3. 返回响应数据
  return response.data
}

// 错误响应
;async (error) => {
  // 1. 处理 401 未授权
  if (error.response?.status === 401 && !isRetryAttempted) {
    // 刷新 token 并重试
    const newToken = await MyAxios.getRefreshPromise()
    originalRequest.headers.Authorization = `Bearer ${newToken}`
    return this.instance.request(originalRequest)
  }

  // 2. 触发错误事件
  webEventBus.emit(statusMsg, error)

  return error.response
}
```

## Token 管理

### 1. Token 解析

```typescript
// 解析 JWT payload（不验证签名）
const parseJWT = <T>(token: string): TokenPayload<T> | null => {
  const parts = token.split('.')
  const payload = parts[1]
  // Base64URL 解码
  const jsonPayload = decodeURIComponent(atob(base64)...)
  const claims: JWTClaims = JSON.parse(jsonPayload)
  return JSON.parse(claims.data)
}
```

### 2. Token 过期检查

```typescript
// 检查 token 是否过期（带缓冲期）
const isTokenExpired = (bufferSeconds: number = 3): boolean => {
  const expiration = localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)
  const expirationTime = parseFloat(expiration)
  const currentTime = Date.now() / 1000
  return currentTime >= expirationTime - bufferSeconds
}
```

### 3. Token 刷新策略

**单 Promise 模式**:

```typescript
private static refreshTokenPromise: Promise<string> | null = null

private static getRefreshPromise(): Promise<string> {
  if (!MyAxios.refreshTokenPromise) {
    MyAxios.refreshTokenPromise = new Promise<string>((resolve, reject) => {
      // 监听刷新成功/失败事件
      authEventBus.on('ACCESS_TOKEN_REFRESHED', resolve)
      authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', reject)
      // 触发刷新请求
      authEventBus.emit('REQUEST_REFRESH_TOKEN')
    }).finally(() => {
      MyAxios.refreshTokenPromise = null
    })
  }
  return MyAxios.refreshTokenPromise
}
```

**优势**:

- 多个并发请求共享同一个刷新 Promise
- 避免重复刷新 token
- 刷新失败时所有等待的请求都会收到通知

## 排除的 URL

某些 URL 不需要 token 刷新逻辑:

```typescript
// constant/request.ts
export const EXCLUDED_URLS = ['/auth/login', '/auth/refresh', '/auth/register']
```

## 自定义响应码处理

### 1. 自定义响应码定义

```typescript
// constant/custom-code.ts 以 src/constant/custom-code.ts 为准
export const CustomCode = {
  OK: 0,
  AUTH_FAILED: 1001,
  TOKEN_EXPIRED_DUE_TO_UPDATE: 1006,
  // ... 更多自定义码
} as const
```

### 2. 响应码事件触发

```typescript
// 在响应拦截器中
const codeMsg = getCustomCodeText(response.data?.code)
if (codeMsg) {
  customCodeBus.emit(codeMsg as keyof typeof CustomCode, response.data)
}
```

### 3. 响应码事件监听

```typescript
// events/index.ts
customCodeBus.on('TOKEN_EXPIRED_DUE_TO_UPDATE', () => {
  ElNotification({
    title: i18ns.t('notification.tokenExpiredDueToUpdate.title'),
    message: i18ns.t('notification.tokenExpiredDueToUpdate.message'),
    type: 'warning',
  })
  authorizationService.logout()
})
```

## 最佳实践

### 1. 始终使用类型

```typescript
// ✅ 好的做法
const result = await request.post<LoginApiType>(url, data)

// ❌ 避免
const result = await request.post(url, data) // 失去类型安全
```

### 2. 在服务层封装

```typescript
// ✅ 好的做法 - 在服务层封装
export class UserService {
  async getMe() {
    const request = useRequestStore().getAxios()
    return await request.get<GetMeApiType>(API_ENDPOINTS.GetMe.url)
  }
}

// ❌ 避免 - 在组件中直接调用
const result = await useRequestStore().getAxios().get(...)
```

### 3. 处理错误

```typescript
try {
  const result = await permissionService.getUserPermissions(userId)
  if (result.code === CustomCode.OK) {
    // 处理成功
  }
} catch (err) {
  console.error('获取权限失败:', err)
  // 处理错误
}
```

### 4. 使用 API_ENDPOINTS

```typescript
// ✅ 好的做法
const url = API_ENDPOINTS.Login.url

// ❌ 避免硬编码
const url = '/auth/login'
```

## 开发工作流

### 1. 后端 API 变更后

```bash
# 重新生成客户端
pnpm run openapi:generate

# 这会自动：
# 1. 获取最新的 OpenAPI 规范
# 2. 生成新的类型定义
# 3. 更新 API 端点元数据
# 4. 运行代码检查和格式化
```

### 2. 提交前检查

```bash
# 预提交钩子会自动运行
pnpm run precommit

# 包括：
# - 重新生成 API 客户端
# - ESLint 检查
# - Prettier 格式化
# - TypeScript 类型检查
```

### 3. 调试 API 请求

```typescript
// 在浏览器控制台查看请求详情
const request = useRequestStore().getAxios()
const axios = request.getAxios()

// 查看拦截器
console.log(axios.interceptors)

// 查看当前 token
console.log(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN))
```

## 故障排查

### 1. Token 刷新失败

**症状**: 请求返回 401，无法自动刷新

**检查**:

- Refresh token 是否存在
- Refresh token 是否过期
- 后端刷新接口是否正常

### 2. 类型不匹配

**症状**: TypeScript 报错类型不匹配

**解决**:

```bash
# 重新生成客户端
pnpm run openapi:generate

# 检查后端 OpenAPI 规范是否正确
curl http://localhost:10001/docs/openapi.json
```

### 3. 请求被拦截

**症状**: 请求没有发送或被阻止

**检查**:

- 是否在 EXCLUDED_URLS 中
- 请求头是否正确设置
- CORS 配置是否正确

## 总结

本项目的 API 客户端系统具有以下特点:

1. **类型安全**: OpenAPI 生成的完整类型定义
2. **自动化**: 一键生成客户端代码
3. **智能刷新**: 自动检测和刷新过期 token
4. **事件驱动**: 响应码和状态码触发事件
5. **易于维护**: 后端变更后重新生成即可
6. **开发友好**: 完整的类型提示和自动补全
