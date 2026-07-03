# 开发文档索引

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 📚 文档概览

本目录包含项目的完整开发文档，涵盖架构设计、API 开发、数据库设计、认证系统、开发工作流、Bun 部署和测试指南等内容。

## 📖 文档列表

### [01. 架构设计文档](./01-architecture.md)

**内容概要**:

- 项目技术栈和核心特性
- 三层架构模式（Controller-Service-Repository）
- 路由系统和中间件链
- 目录结构和数据流
- 设计原则和扩展性考虑

**适合阅读对象**: 新加入项目的开发者、架构师、技术负责人

**关键主题**:

- 🏗️ 架构模式
- 📁 项目结构
- 🔄 数据流
- 🔐 安全性设计
- 📊 监控与日志

---

### [02. API 开发文档](./02-api-development.md)

**内容概要**:

- TSOA 代码优先 API 开发
- 现有 API 模块详解（认证、用户、权限、短链、文档）
- 统一响应格式和错误处理
- 开发新 API 的完整流程
- TSOA 装饰器参考

**适合阅读对象**: API 开发者、前端对接人员

**关键主题**:

- 🎯 API 端点定义
- 📝 DTO 设计
- 🔒 认证与授权
- ✅ 参数验证
- 🛠️ 开发最佳实践

---

### [03. 数据库设计文档](./03-database-design.md)

**内容概要**:

- Prisma ORM 使用指南
- 数据库模型详解（User、Group、IPBlackList、APILog）
- 数据库迁移和版本控制
- 查询优化和性能考虑
- 数据库操作最佳实践

**适合阅读对象**: 后端开发者、数据库管理员

**关键主题**:

- 🗄️ 数据模型
- 🔄 迁移管理
- 🔍 查询优化
- 🔐 数据安全
- 📊 关系设计

---

### [04. 认证系统文档](./04-authentication.md)

**内容概要**:

- JWT 双令牌认证机制
- 认证流程详解
- 权限系统设计（RBAC）
- 认证中间件实现
- 安全最佳实践

**适合阅读对象**: 安全工程师、后端开发者

**关键主题**:

- 🔐 JWT 认证
- 🎫 令牌管理
- 👥 权限控制
- 🛡️ 安全防护
- 🔑 密码管理

---

### [05. 开发工作流文档](./05-development-workflow.md)

**内容概要**:

- 环境准备和配置
- 日常开发流程
- 构建和部署流程
- 添加新功能的步骤
- 代码规范和配置

**适合阅读对象**: 所有开发者

**关键主题**:

- 🚀 快速开始
- 🔧 环境配置
- 📦 构建流程
- 🎨 代码规范
- 🐛 常见问题

---

### [06. 测试指南](./06-testing-guide.md)

**内容概要**:

- Vitest 测试框架使用
- API 集成测试
- 单元测试和 Mock 技巧
- 测试最佳实践
- 持续集成配置

**适合阅读对象**: 测试工程师、开发者

**关键主题**:

- ✅ 测试配置
- 🧪 测试编写
- 🎭 Mock 技巧
- 📊 覆盖率
- 🔍 调试技巧

---

### [07. Bun 部署与回滚指南](./07-bun-deployment.md)

**内容概要**:

- Bun + PM2 部署前检查
- Linux 服务器平滑切换步骤
- 运行验证与观察项
- 回滚方案与风险点

**适合阅读对象**: 运维、后端开发者、发布负责人

**关键主题**:

- 🚀 Bun 部署
- 🔁 平滑切换
- ✅ 上线验证
- ↩️ 回滚方案

---

## 🚀 快速开始

### 新开发者入门路径

1. **第一步**: 阅读 [架构设计文档](./01-architecture.md)，了解项目整体架构
2. **第二步**: 阅读 [开发工作流文档](./05-development-workflow.md)，配置开发环境
3. **第三步**: 阅读 [API 开发文档](./02-api-development.md)，了解如何开发 API
4. **第四步**: 阅读 [数据库设计文档](./03-database-design.md)，了解数据模型
5. **第五步**: 阅读 [测试指南](./06-testing-guide.md)，学习如何编写测试
6. **上线前**: 阅读 [Bun 部署与回滚指南](./07-bun-deployment.md)，完成服务器切换检查

### 特定任务快速索引

| 任务              | 参考文档                                       | 章节    |
| ----------------- | ---------------------------------------------- | ------- |
| 添加新的 API 端点 | [API 开发文档](./02-api-development.md)        | 第 9 节 |
| 修改数据库模型    | [数据库设计文档](./03-database-design.md)      | 第 5 节 |
| 实现权限控制      | [认证系统文档](./04-authentication.md)         | 第 4 节 |
| 配置开发环境      | [开发工作流文档](./05-development-workflow.md) | 第 2 节 |
| 编写 API 测试     | [测试指南](./06-testing-guide.md)              | 第 5 节 |
| 构建和部署        | [开发工作流文档](./05-development-workflow.md) | 第 4 节 |
| Bun 上线与回滚    | [Bun 部署与回滚指南](./07-bun-deployment.md)   | 全文    |
| 理解三层架构      | [架构设计文档](./01-architecture.md)           | 第 2 节 |
| JWT 认证流程      | [认证系统文档](./04-authentication.md)         | 第 2 节 |

## 🔍 按主题查找

### 架构与设计

- [三层架构模式](./01-architecture.md#21-三层架构)
- [路由系统](./01-architecture.md#22-路由系统)
- [中间件链](./01-architecture.md#23-中间件链)
- [数据流](./01-architecture.md#4-数据流)

### API 开发

- [认证模块 API](./02-api-development.md#3-认证模块-authentication)
- [用户模块 API](./02-api-development.md#4-用户模块-user)
- [权限模块 API](./02-api-development.md#5-权限模块-permission)
- [统一响应格式](./02-api-development.md#8-统一响应格式)
- [TSOA 装饰器](./02-api-development.md#10-tsoa-装饰器参考)

### 数据库

- [User 模型](./03-database-design.md#21-user-用户表)
- [Group 模型](./03-database-design.md#22-group-用户组表)
- [数据库迁移](./03-database-design.md#5-数据库迁移)
- [查询优化](./03-database-design.md#7-性能优化)

### 认证与权限

- [JWT 双令牌机制](./04-authentication.md#2-jwt-双令牌认证)
- [权限系统设计](./04-authentication.md#4-权限系统)
- [认证中间件](./04-authentication.md#3-认证实现)
- [安全最佳实践](./04-authentication.md#6-安全最佳实践)

### 开发流程

- [环境配置](./05-development-workflow.md#2-环境准备)
- [日常开发](./05-development-workflow.md#3-日常开发)
- [构建流程](./05-development-workflow.md#4-构建流程)
- [添加新功能](./05-development-workflow.md#6-添加新功能流程)
- [Bun 部署与回滚](./07-bun-deployment.md)

### 测试

- [测试环境配置](./06-testing-guide.md#2-测试环境配置)
- [API 测试](./06-testing-guide.md#5-api-测试)
- [单元测试](./06-testing-guide.md#6-单元测试)
- [Mock 技巧](./06-testing-guide.md#7-mock-技巧)

## 📝 文档维护

### 更新文档

当项目发生重大变更时，请及时更新相关文档：

1. **架构变更**: 更新 [架构设计文档](./01-architecture.md)
2. **API 变更**: 更新 [API 开发文档](./02-api-development.md)
3. **数据库变更**: 更新 [数据库设计文档](./03-database-design.md)
4. **认证变更**: 更新 [认证系统文档](./04-authentication.md)
5. **流程变更**: 更新 [开发工作流文档](./05-development-workflow.md)
6. **测试变更**: 更新 [测试指南](./06-testing-guide.md)
7. **部署变更**: 更新 [Bun 部署与回滚指南](./07-bun-deployment.md)

### 文档版本

每次重大更新时，请更新文档头部的版本信息：

```markdown
**版本**: v2
**日期**: YYYY/MM/DD
**提交哈希**: <git-commit-hash>
```

## 🤝 贡献指南

### 文档编写规范

1. **使用中文**: 所有文档使用中文编写
2. **Markdown 格式**: 遵循 Markdown 语法规范
3. **代码示例**: 提供清晰的代码示例
4. **结构清晰**: 使用合理的标题层级
5. **保持更新**: 及时更新过时内容

### 文档审查

提交文档更新前，请确保：

- [ ] 内容准确无误
- [ ] 代码示例可运行
- [ ] 链接正确有效
- [ ] 格式规范统一
- [ ] 无拼写错误

## 📞 获取帮助

如果文档中有不清楚的地方：

1. 查看相关源代码
2. 查看 [CLAUDE.md](../../CLAUDE.md) 项目指南
3. 查看 Swagger UI 文档: `http://localhost:10001/docs`
4. 联系项目维护者

## 🔗 相关资源

### 项目资源

- [CLAUDE.md](../../CLAUDE.md) - Claude Code 项目指南
- [package.json](../../package.json) - 项目依赖和脚本
- [tsconfig.json](../../tsconfig.json) - TypeScript 配置
- [prisma/schema.prisma](../../prisma/schema.prisma) - 数据库模型

### 外部文档

- [TSOA 官方文档](https://tsoa-community.github.io/docs/)
- [Prisma 官方文档](https://www.prisma.io/docs)
- [Vitest 官方文档](https://vitest.dev/)
- [Express 官方文档](https://expressjs.com/)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)

---

**最后更新**: 2026/2/10
**维护者**: 开发团队
