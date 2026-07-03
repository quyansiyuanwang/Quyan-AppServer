# 开发文档索引

**文档版本**: v1  
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444  
**文档日期**: 2026/2/10

## 文档目录

| #   | 文档                                           | 说明                                               |
| --- | ---------------------------------------------- | -------------------------------------------------- |
| 01  | [系统架构文档](./01-architecture.md)           | 项目整体架构、技术栈、目录结构、启动流程、核心模式 |
| 02  | [API 客户端文档](./02-api-client.md)           | OpenAPI 客户端生成、使用方式、拦截器、Token 管理   |
| 03  | [认证与授权文档](./03-auth.md)                 | JWT 认证、Token 刷新、权限系统、事件系统           |
| 04  | [状态管理文档](./04-state-management.md)       | Pinia Stores、事件总线、状态持久化                 |
| 05  | [开发工作流文档](./05-development-workflow.md) | 环境配置、常用命令、构建配置、代码规范             |
| 06  | [国际化文档](./06-i18n.md)                     | Vue-i18n 配置、翻译使用、类型安全                  |

## 快速导航

### 新开发者入门

1. 阅读 [系统架构文档](./01-architecture.md) 了解项目整体结构
2. 阅读 [开发工作流文档](./05-development-workflow.md) 配置开发环境
3. 阅读 [API 客户端文档](./02-api-client.md) 了解如何调用后端 API

### 功能开发参考

- 认证相关开发 → [认证与授权文档](./03-auth.md)
- 状态管理和事件 → [状态管理文档](./04-state-management.md)
- 多语言支持 → [国际化文档](./06-i18n.md)

## 技术栈速览

- **Vue 3** (Composition API) + **TypeScript 5.9** + **Vite (rolldown-vite)**
- **Pinia 3.0** 状态管理
- **Vue Router 4.6** 路由管理（Hash 模式）
- **Element Plus 2.11** UI 组件库（自动导入）
- **Vue-i18n 11.2** 国际化
- **Axios 1.13** HTTP 客户端 + JWT
- **@hey-api/openapi-ts** API 客户端生成

## 关键目录

```
src/
├── client/     # 自动生成的 API 客户端（禁止手动编辑）
├── stores/     # Pinia 状态管理
├── service/    # 业务逻辑服务层
├── views/      # 页面组件
├── layouts/    # 布局组件
├── components/ # 可复用组件
├── locales/    # 国际化翻译
├── constant/   # 常量定义
├── events/     # 事件总线注册
├── utils/      # 工具函数
└── types/      # TypeScript 类型
```
