# 认证与授权文档

**文档版本**: v1
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444
**文档日期**: 2026/2/10

## 概述

本项目采用 JWT (JSON Web Token) 进行身份认证，配合基于角色和权限的授权系统，实现完整的认证授权流程。

## 当前认证模型

Refresh Token 仅由 HttpOnly Cookie 保存；Access Token 只保存在进程内存。启动时会清除历史 localStorage token 键，旧登录状态必须通过 Cookie refresh 重新建立。

`SessionCoordinator` 是唯一认证生命周期入口：

- `ensureSession()`：受保护导航的幂等 Cookie 会话恢复。
- `completeLogin()`：接收登录响应中的 Access Token 并启动会话依赖。
- `hydrateUserAndPermissions()`：按用户资料、全权限目录、当前用户权限的固定顺序水合状态。
- `refresh()`：所有并发 401 重试共享同一 Cookie refresh Promise。
- `logout()`：清理内存状态和会话依赖；页面再由导航服务进入认证入口。

游客页面不得调用上述恢复接口。路由守卫只判断会话，页面基于 `sessionStore.permissionsStatus` 表达权限 pending、ready 或 failed。

## 历史实现

### JWT Token 体系

**Token 类型**:

| Token            | 用途                  | 存储位置                                               |
| ---------------- | --------------------- | ------------------------------------------------------ |
| Access Token     | 请求身份验证          | `localStorage['Authentication-AccessToken']`           |
| Refresh Token    | 刷新 Access Token     | `localStorage['Authentication-RefreshToken']`          |
| Token Expiration | Access Token 过期时间 | `localStorage['Authentication-AccessTokenExpiration']` |

### 认证服务 (authorizationService.ts)

认证服务采用**单例模式**，提供以下核心方法:

#### 登录 (login)

```typescript
async login(username: string, password: string) {
  // 1. 发送登录请求
  const result = await request.post<LoginApiType>(API_ENDPOINTS.Login.url, { username, password })

  // 2. 存储 token
  if (result.code === CustomCode.OK && result.data) {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, result.data.access_token)
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, result.data.refresh_token)
    saveTokenExpiration(result.data.access_token)  // 从 JWT 中提取并保存过期时间
  }

  return result
}
```

#### Token 刷新 (refreshToken)

```typescript
async refreshToken(refresh_token?: string) {
  // 1. 获取 refresh token
  if (!refresh_token)
    refresh_token = localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)

  // 2. 发送刷新请求（禁用自动重试）
  const res = await request.post<RefreshApiType>(
    API_ENDPOINTS.Refresh.url,
    { refresh_token },
    { retry: false }
  )

  // 3. 处理响应
  if (res.code === CustomCode.OK) {
    // 成功: 更新 access token 并通知
    authEventBus.emit('ACCESS_TOKEN_REFRESHED', res.data.access_token)
  } else if (res.code === CustomCode.AUTH_FAILED) {
    // 失败: 清除所有 token
    authEventBus.emit('ACCESS_TOKEN_REFRESH_FAILED', new Error('Token refresh failed'))
  } else if (res.code === CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE) {
    // 权限变更导致 token 过期
    customCodeBus.emit('TOKEN_EXPIRED_DUE_TO_UPDATE')
  }
}
```

#### 登出 (logout)

```typescript
logout() {
  // 1. 清除所有 token
  localStorage.removeItem(StorageKey.Auth.ACCESS_TOKEN)
  localStorage.removeItem(StorageKey.Auth.REFRESH_TOKEN)
  clearTokenExpiration()

  // 2. 发出登出事件
  authEventBus.emit('USER_LOGGED_OUT')

  // 3. 重定向到登录页
  router.push({ name: 'login' })
}
```

### Token 自动刷新机制

#### 刷新流程图

```
请求拦截器
  ↓
检查 token 是否过期（3秒缓冲期）
  ↓
  ├─ 未过期 → 正常发送请求
  └─ 已过期 → 获取/创建刷新 Promise
      ↓
      等待 authEventBus 事件
        ├─ ACCESS_TOKEN_REFRESHED → 使用新 token 发送请求
        └─ ACCESS_TOKEN_REFRESH_FAILED → 请求失败

响应拦截器
  ↓
检查响应状态码
  ├─ 200 → 检查自定义码 → 触发事件 → 返回数据
  └─ 401 → 尝试刷新 token
      ├─ 刷新成功 → 重试原始请求
      └─ 刷新失败 → 触发 Unauthorized 事件
```

#### 单 Promise 模式（防止并发刷新）

当多个请求同时发现 token 过期时，只会创建一个刷新 Promise，所有请求共享同一个刷新结果:

```typescript
private static refreshTokenPromise: Promise<string> | null = null

private static getRefreshPromise(): Promise<string> {
  if (!MyAxios.refreshTokenPromise) {
    MyAxios.refreshTokenPromise = new Promise<string>((resolve, reject) => {
      authEventBus.on('ACCESS_TOKEN_REFRESHED', resolve)
      authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', reject)
      authEventBus.emit('REQUEST_REFRESH_TOKEN')
    }).finally(() => {
      MyAxios.refreshTokenPromise = null  // 清理 Promise
    })
  }
  return MyAxios.refreshTokenPromise  // 后续请求复用同一个 Promise
}
```

### Token 过期检测

```typescript
const isTokenExpired = (bufferSeconds: number = 3): boolean => {
  // 1. 从 localStorage 获取过期时间
  let expiration = localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)

  // 2. 如果没有，尝试从 JWT 中解析
  if (!expiration) {
    const token = localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)
    const payload = parseJWT(token)
    expiration = payload?.expiration?.toString()
  }

  // 3. 比较当前时间（带缓冲期）
  const expirationTime = parseFloat(expiration)
  const currentTime = Date.now() / 1000
  return currentTime >= expirationTime - bufferSeconds
}
```

### 路由守卫

```typescript
router.beforeEach(async (to, from, next) => {
  const hasToken =
    localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN) ||
    localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)

  // 登录页直接放行
  if (to.name === 'login') return next()

  // 无 token 重定向到登录页
  if (!hasToken) return next({ name: 'login' })

  // 正常导航
  next()
})
```

## 授权系统（权限管理）

### 权限模型

**权限层级结构**:

```
用户组权限 (Group Permissions)
  + 额外添加的权限 (Additional Permissions)
  - 被移除的权限 (Removed Permissions)
  = 有效权限 (Effective Permissions)
```

### 权限 Store (permissionStore.ts)

**状态**:

```typescript
const allPermissions = ref<AllPermissionsDto['permissions']>([]) // 所有可用权限
const currentUserPermissions = ref<UserFullPermissionsDto | null>(null) // 当前用户权限
const loading = ref(false)
const error = ref<string | null>(null)
```

**计算属性**:

```typescript
const effectivePermissions = computed(() =>
  currentUserPermissions.value?.effectivePermissions || [])
const groupPermissions = computed(() =>
  currentUserPermissions.value?.groupPermissions || [])
const additionalPermissions = computed(() =>
  currentUserPermissions.value?.additionalPermissions || [])
const removedPermissions = computed(() =>
  currentUserPermissions.value?.removedPermissions || [])
const permissionCategories = computed(() =>
  /* 从 allPermissions 提取去重分类 */)
```

**本地权限检查方法**:

```typescript
// 检查单个权限
const hasPermission = (permission: string): boolean =>
  effectivePermissions.value.includes(permission as Permission)

// 检查任意一个权限
const hasAnyPermission = (...permissions: string[]): boolean =>
  permissions.some((perm) => hasPermission(perm))

// 检查所有权限
const hasAllPermissions = (...permissions: string[]): boolean =>
  permissions.every((perm) => hasPermission(perm))
```

### 权限服务 (permissionService.ts)

**API 方法**:

| 方法                                  | 说明               | 端点                                      |
| ------------------------------------- | ------------------ | ----------------------------------------- |
| `getAllPermissions()`                 | 获取所有可用权限   | `GET /permissions`                        |
| `getUserPermissions(userId)`          | 获取用户完整权限   | `GET /users/{userId}/permissions`         |
| `setUserPermissions(userId, data)`    | 设置用户权限       | `POST /users/{userId}/permissions/set`    |
| `addUserPermissions(userId, data)`    | 添加用户权限       | `POST /users/{userId}/permissions/add`    |
| `removeUserPermissions(userId, data)` | 移除用户权限       | `POST /users/{userId}/permissions/remove` |
| `clearUserPermissions(userId)`        | 清空用户自定义权限 | `GET /users/{userId}/permissions/clear`   |
| `checkPermissions(data)`              | 检查权限           | `POST /permissions/check`                 |
| `getGroupPermissions(groupId)`        | 获取组权限         | `GET /groups/{groupId}/permissions`       |
| `setGroupPermissions(groupId, data)`  | 设置组权限         | `POST /groups/{groupId}/permissions/set`  |

### 权限初始化

应用启动时自动加载权限:

```typescript
// permissionStore.ts - init()
const init = async () => {
  // 并行加载：所有权限列表 + 当前用户权限
  permissionService.getAllPermissions().then((result) => {
    allPermissions.value = result.data.permissions
  })

  permissionService.loadCurrentUserPermissions().then((result) => {
    currentUserPermissions.value = result.data
  })
}
```

### 权限变更处理

当管理员修改某用户的权限时:

```
1. 管理员调用 setUserPermissions API
   ↓
2. 后端更新权限，使相关用户的 token 失效
   ↓
3. 被修改权限的用户下次请求时:
   - 收到自定义码 TOKEN_EXPIRED_DUE_TO_UPDATE (1006)
   ↓
4. 响应拦截器触发 customCodeBus 事件
   ↓
5. 事件处理器弹出确认框，用户确认后登出
   ↓
6. 用户重新登录获取新的权限
```

## 事件系统

### 认证相关事件

```typescript
// constant/events.ts
export enum AuthEventEnum {
  ACCESS_TOKEN_REFRESHED, // Token 刷新成功
  ACCESS_TOKEN_REFRESH_FAILED, // Token 刷新失败
  REQUEST_REFRESH_TOKEN, // 请求刷新 Token
  TOKEN_EXPIRED_DUE_TO_UPDATE, // Token 因权限变更过期
  USER_LOGGED_OUT, // 用户登出
  USER_INFO_UPDATED, // 用户信息更新
}
```

### 事件注册 (events/index.ts)

```typescript
export function registerAuthEvents() {
  // Token 刷新请求
  authEventBus.on('REQUEST_REFRESH_TOKEN', authorizationService.refreshToken)

  // Token 刷新失败 → 弹出确认框 → 登出
  authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', () => {
    ElMessageBox.confirm(
      i18ns.t('message.warning.autoRedirectToLogin'),
      i18ns.t('message.warning.sessionExpired'),
    ).then(() => authorizationService.logout())
  })
}

export function registerCustomCodeEvents() {
  // 权限变更导致 Token 过期 → 弹出确认框 → 登出
  customCodeBus.on('TOKEN_EXPIRED_DUE_TO_UPDATE', () => {
    ElMessageBox.confirm(
      i18ns.t('message.warning.permissionUpdated'),
      i18ns.t('message.warning.sessionExpired'),
    ).then(() => authorizationService.logout())
  })
}
```

## 自定义响应码

```typescript
// constant/custom-code.ts
export enum CustomCode {
  OK = 0, // 操作成功
  AUTH_FAILED = 1001, // 认证失败
  VALIDATION_FAILED = 1002, // 参数校验失败
  NOT_FOUND = 1003, // 资源不存在
  PERMISSION_DENIED = 1004, // 权限不足
  INTERNAL_SERVER_ERROR = 1005, // 服务器内部错误
  TOKEN_EXPIRED_DUE_TO_UPDATE = 1006, // Token 因权限变更过期
}
```

## LocalStorage 键名

```typescript
// constant/storagekey.ts
const StorageKey = {
  Theme: {
    THEME_TOGGLE_IS_DARK: 'ThemeToggle-isDark',
  },
  Auth: {
    ACCESS_TOKEN: 'Authentication-AccessToken',
    REFRESH_TOKEN: 'Authentication-RefreshToken',
    ACCESS_TOKEN_EXPIRATION: 'Authentication-AccessTokenExpiration',
  },
  Util: {
    LOCALE: 'Util-Locale',
  },
  User: {
    INFO: 'User-Info',
  },
} as const
```

## 认证流程总结

### 登录流程

```
用户输入凭据
  ↓
authorizationService.login(username, password)
  ↓
后端验证 → 返回 access_token + refresh_token
  ↓
存储到 localStorage + 解析过期时间
  ↓
路由跳转到 /home
  ↓
permissionStore.init() 加载权限
```

### 请求流程

```
发起 API 请求
  ↓
请求拦截器检查 token 状态
  ├─ Token 有效 → 注入 Authorization 头 → 发送请求
  └─ Token 过期 → 触发刷新
      ↓
      等待刷新结果 → 使用新 token → 发送请求
  ↓
响应拦截器处理
  ├─ 200 + CustomCode.OK → 返回数据
  ├─ 200 + 自定义错误码 → 触发 customCodeBus 事件
  ├─ 401 → 尝试刷新 token 并重试
  └─ 其他错误 → 触发 webEventBus 事件
```

### 登出流程

```
用户登出 / Token 刷新失败 / 权限变更
  ↓
authorizationService.logout()
  ↓
清除所有 localStorage token
  ↓
authEventBus.emit('USER_LOGGED_OUT')
  ↓
waterMarkTextStore.clearText()
  ↓
router.push({ name: 'login' })
```
