# 状态管理文档

**文档版本**: v1
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444
**文档日期**: 2026/2/10

## 概述

本项目使用 Pinia 3.0 作为状态管理库，采用 Composition API 风格定义 Store。

## Pinia Stores 列表

| Store              | 文件                         | 职责                    |
| ------------------ | ---------------------------- | ----------------------- |
| Request            | `request.ts`                 | HTTP 客户端、Token 管理 |
| GlobalInstance     | `globalInstance.ts`          | 事件总线实例            |
| Permission         | `permissionStore.ts`         | 权限状态、本地权限检查  |
| UserInfo           | `userInfoStore.ts`           | 用户信息、持久化        |
| ThemeToggle        | `themeToggleStore.ts`        | 主题切换（暗色/亮色）   |
| TopLoadingProgress | `topLoadingProgressStore.ts` | 顶部进度条              |
| WaterMarkText      | `waterMarkTextStore.ts`      | 水印文本                |
| i18n               | `i18nStore.ts`               | 国际化状态              |
| IsDesktop          | `isDesktopStore.ts`          | 设备类型检测            |

## 核心 Stores 详解

### 1. Request Store (request.ts)

**职责**: 管理 HTTP 客户端和 Token 刷新逻辑

**核心功能**:

- 创建和管理 MyAxios 实例
- Token 自动注入和刷新
- 请求/响应拦截
- 事件总线集成

**使用示例**:

```typescript
const request = useRequestStore().getAxios()
const result = await request.post<LoginApiType>(url, data)
```

### 2. UserInfo Store (userInfoStore.ts)

**职责**: 管理用户信息并持久化到 localStorage

**状态**:

```typescript
const userInfo = ref<UserDto>({ ...DefaultUserInfo })
const isUserInfoFetched = ref<boolean>(false)
```

**核心方法**:

- `init()` - 从 localStorage 加载或从 API 获取
- `fetchUserInfo()` - 从 API 获取用户信息
- `setUserInfo(newInfo)` - 更新用户信息
- `clear()` - 清除用户信息
- `isLoggedIn()` - 检查是否已登录

**持久化机制**:

```typescript
// 监听变化自动保存
watch(
  () => userInfo.value,
  (newValue) => {
    saveToStorage(newValue)
  },
  { deep: true },
)
```

### 3. Permission Store (permissionStore.ts)

详见 [认证与授权文档](./03-auth.md#授权系统权限管理)

### 4. ThemeToggle Store (themeToggleStore.ts)

**职责**: 管理应用主题（暗色/亮色模式）

**核心功能**:

- 使用 `@vueuse/core` 的 `useColorMode`
- 支持自动模式（跟随系统）
- 持久化到 localStorage
- 自动更新 HTML 类名和 CSS 变量

**使用示例**:

```typescript
const themeStore = useThemeToggleStore()
const isDark = themeStore.useIsDark()
const toggleTheme = themeStore.toggleTheme

// 在模板中
<el-button @click="toggleTheme">切换主题</el-button>
```

## Store 定义模式

### Composition API 风格

```typescript
export const useMyStore = defineStore('myStore', () => {
  // State
  const count = ref(0)
  const name = ref('John')

  // Computed
  const doubleCount = computed(() => count.value * 2)

  // Actions
  const increment = () => {
    count.value++
  }

  const reset = () => {
    count.value = 0
    name.value = 'John'
  }

  return {
    // State
    count,
    name,
    // Computed
    doubleCount,
    // Actions
    increment,
    reset,
  }
})
```

## 状态持久化

### TypedLocalStorage 工具

位于 `utils/typedLocalStorage.ts`，提供类型安全的 localStorage 操作:

```typescript
// 保存
TypedLocalStorage.set(StorageKey.User.INFO, userInfo)

// 读取
const userInfo = TypedLocalStorage.get(StorageKey.User.INFO, defaultValue)

// 删除
TypedLocalStorage.remove(StorageKey.User.INFO)
```

### 自动持久化模式

```typescript
// 监听状态变化并自动保存
watch(
  () => state.value,
  (newValue) => {
    TypedLocalStorage.set(key, newValue)
  },
  { deep: true },
)

// 初始化时从 localStorage 加载
const init = () => {
  const stored = TypedLocalStorage.get(key, defaultValue)
  if (stored) state.value = stored
}
```

## 事件总线 Store (globalInstance.ts)

**职责**: 提供全局事件总线实例

**事件总线类型**:

```typescript
export const webEventBus = new EventBus<keyof typeof HttpStatusCode, ...>()
export const authEventBus = new EventBus<AUTH_EVENTS, ...>()
export const customCodeBus = new EventBus<keyof typeof CustomCode, ...>()
export const i18nEventBus = new EventBus<I18N_EVENTS, ...>()
export const windowEventBus = new EventBus<WINDOW_EVENTS, ...>()
export const globalEventBus = new EventBus<GLOBAL_EVENTS, ...>()
```

**EventBus 类方法**:

- `on(event, listener, ahead?)` - 注册监听器
- `emit(event, ...data)` - 触发事件
- `off(event, listener)` - 移除监听器
- `auto(event, listener, ahead?)` - 自动注册/注销（组件生命周期）

**使用示例**:

```typescript
// 注册监听器
authEventBus.on('USER_LOGGED_OUT', () => {
  console.log('User logged out')
})

// 触发事件
authEventBus.emit('USER_LOGGED_OUT')

// 在组件中自动管理生命周期
authEventBus.auto('USER_LOGGED_OUT', handleLogout)
```

## Store 初始化

### 应用启动时初始化

```typescript
// main.ts
const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 某些 Store 需要手动初始化
// 例如在 overLay.vue 中
onMounted(async () => {
  await useUserInfoStore().init()
  await usePermissionStore().init()
})
```

## 最佳实践

### 1. 单一职责原则

每个 Store 只负责一个领域的状态管理。

### 2. 使用 Composition API

```typescript
// ✅ 推荐
export const useMyStore = defineStore('myStore', () => {
  const state = ref(0)
  const increment = () => state.value++
  return { state, increment }
})

// ❌ 避免 Options API
export const useMyStore = defineStore('myStore', {
  state: () => ({ count: 0 }),
  actions: {
    increment() {
      this.count++
    },
  },
})
```

### 3. 类型安全

```typescript
// 定义类型
interface UserState {
  id: string
  name: string
}

// 使用类型
const userInfo = ref<UserState>({ id: '', name: '' })
```

### 4. 避免直接修改状态

```typescript
// ✅ 通过 action 修改
const setName = (name: string) => {
  userInfo.value.name = name
}

// ❌ 避免在组件中直接修改
userInfo.value.name = 'New Name'
```

### 5. 合理使用 computed

```typescript
// 派生状态使用 computed
const fullName = computed(() => `${userInfo.value.firstName} ${userInfo.value.lastName}`)
```
