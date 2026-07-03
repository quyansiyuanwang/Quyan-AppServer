# 数据库设计文档

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本项目使用 MySQL 数据库，通过 Prisma ORM 进行数据访问。数据库设计遵循规范化原则，所有表都包含统一的基础字段。

### 1.1 技术栈

- **数据库**: MySQL 8.0+
- **ORM**: Prisma 6.x
- **迁移工具**: Prisma Migrate
- **管理工具**: Prisma Studio

### 1.2 数据库连接

配置在 `.env` 文件中：

```
DATABASE_URL="mysql://user:password@localhost:3306/database_name"
```

## 2. 数据模型概览

### 2.1 模型列表

| 模型        | 表名           | 说明           |
| ----------- | -------------- | -------------- |
| User        | users          | 用户表         |
| Group       | groups         | 用户组表       |
| IPBlackList | ip_black_lists | IP 黑名单表    |
| APILog      | api_logs       | API 请求日志表 |

### 2.2 关系图

```
Group (1) ──────< (N) User
```

## 3. 基础字段规范

所有表都包含以下基础字段：

| 字段       | 类型     | 说明               | 默认值   |
| ---------- | -------- | ------------------ | -------- |
| id         | String   | 主键，CUID 格式    | cuid()   |
| status     | Int      | 状态标识（软删除） | 1        |
| createTime | DateTime | 创建时间           | now()    |
| updateTime | DateTime | 更新时间           | 自动更新 |

**status 字段说明**:

- `1`: 正常/激活
- `0`: 已删除/禁用

## 4. 用户表 (User)

### 4.1 表结构

```prisma
model User {
  // 基础字段
  id         String   @id @default(cuid())
  status     Int      @default(1)
  createTime DateTime @default(now())
  updateTime DateTime @updatedAt

  // 业务字段
  username          String  @unique
  name              String?
  password          String
  email             String?
  groupId           String
  permissionAdds    Json    @default("[]")
  permissionRemoves Json    @default("[]")

  // 关系
  group Group @relation(fields: [groupId], references: [id])

  @@index([username])
  @@map("users")
}
```

### 4.2 字段说明

| 字段              | 类型   | 必填 | 说明               |
| ----------------- | ------ | ---- | ------------------ |
| username          | String | ✅   | 用户名，唯一       |
| name              | String | ❌   | 显示名称           |
| password          | String | ✅   | 密码哈希（MD5）    |
| email             | String | ❌   | 电子邮箱           |
| groupId           | String | ✅   | 所属用户组 ID      |
| permissionAdds    | Json   | ✅   | 额外添加的权限列表 |
| permissionRemoves | Json   | ✅   | 移除的权限列表     |

### 4.3 权限计算

用户的最终权限 = 组权限 + permissionAdds - permissionRemoves

**示例**:

```
组权限: ["user:read", "user:update"]
permissionAdds: ["user:create"]
permissionRemoves: ["user:update"]
最终权限: ["user:read", "user:create"]
```

### 4.4 索引

- `username`: 唯一索引，用于登录查询

### 4.5 示例数据

```json
{
  "id": "clx1234567890",
  "username": "admin",
  "name": "管理员",
  "password": "5f4dcc3b5aa765d61d8327deb882cf99",
  "email": "admin@example.com",
  "groupId": "clx0987654321",
  "permissionAdds": ["user:delete"],
  "permissionRemoves": [],
  "status": 1,
  "createTime": "2026-02-10T00:00:00.000Z",
  "updateTime": "2026-02-10T00:00:00.000Z"
}
```

## 5. 用户组表 (Group)

### 5.1 表结构

```prisma
model Group {
  // 基础字段
  id         String   @id @default(cuid())
  status     Int      @default(1)
  createTime DateTime @default(now())
  updateTime DateTime @updatedAt

  // 业务字段
  username    String  @unique
  name        String?
  permissions Json    @default("[]")
  level       Int     @default(1)
  description String?

  // 关系
  users User[]

  @@map("groups")
}
```

### 5.2 字段说明

| 字段        | 类型   | 必填 | 说明                       |
| ----------- | ------ | ---- | -------------------------- |
| username    | String | ✅   | 组标识符，唯一             |
| name        | String | ❌   | 组显示名称                 |
| permissions | Json   | ✅   | 组权限列表                 |
| level       | Int    | ✅   | 组等级（数字越大权限越高） |
| description | String | ❌   | 组描述                     |

### 5.3 等级系统

- **level** 字段用于权限层级控制
- 高等级用户可以管理低等级用户
- 用户只能查看和操作等级低于自己的用户

**示例**:

```
超级管理员组: level = 10
管理员组: level = 5
普通用户组: level = 1
```

### 5.4 示例数据

```json
{
  "id": "clx0987654321",
  "username": "admin_group",
  "name": "管理员组",
  "permissions": ["user:read", "user:update", "user:create"],
  "level": 10,
  "description": "系统管理员组",
  "status": 1,
  "createTime": "2026-02-10T00:00:00.000Z",
  "updateTime": "2026-02-10T00:00:00.000Z"
}
```

## 6. IP 黑名单表 (IPBlackList)

### 6.1 表结构

```prisma
model IPBlackList {
  // 基础字段
  id         String   @id @default(cuid())
  status     Int      @default(1)
  createTime DateTime @default(now())
  updateTime DateTime @updatedAt

  // 业务字段
  ipAddress     String   @unique
  TriedAccounts Json     @default("[]")
  ExpireTime    DateTime
  ErrorLevel    Int      @default(1)

  @@index([ipAddress])
  @@map("ip_black_lists")
}
```

### 6.2 字段说明

| 字段          | 类型     | 必填 | 说明               |
| ------------- | -------- | ---- | ------------------ |
| ipAddress     | String   | ✅   | IP 地址，唯一      |
| TriedAccounts | Json     | ✅   | 尝试登录的账户列表 |
| ExpireTime    | DateTime | ✅   | 黑名单过期时间     |
| ErrorLevel    | Int      | ✅   | 错误等级           |

### 6.3 使用场景

- 防止暴力破解攻击
- 记录可疑 IP 地址
- 自动解封机制（基于 ExpireTime）

### 6.4 索引

- `ipAddress`: 唯一索引，用于快速查询

### 6.5 示例数据

```json
{
  "id": "clx1111111111",
  "ipAddress": "192.168.1.100",
  "TriedAccounts": ["admin", "root", "test"],
  "ExpireTime": "2026-02-10T01:00:00.000Z",
  "ErrorLevel": 3,
  "status": 1,
  "createTime": "2026-02-10T00:00:00.000Z",
  "updateTime": "2026-02-10T00:00:00.000Z"
}
```

## 7. API 日志表 (APILog)

### 7.1 表结构

```prisma
model APILog {
  // 基础字段
  id         String   @id @default(cuid())
  status     Int      @default(1)
  createTime DateTime @default(now())
  updateTime DateTime @updatedAt

  // 业务字段
  requestID   String  @unique
  userID      String?
  path        String
  method      String
  queryParams Json?
  bodyParams  Json?
  ipAddress   String
  response    Json?
  statusCode  Int

  @@index([userID])
  @@index([path])
  @@map("api_logs")
}
```

### 7.2 字段说明

| 字段        | 类型   | 必填 | 说明                      |
| ----------- | ------ | ---- | ------------------------- |
| requestID   | String | ✅   | 请求唯一标识（UUID）      |
| userID      | String | ❌   | 用户 ID（未认证请求为空） |
| path        | String | ✅   | 请求路径                  |
| method      | String | ✅   | HTTP 方法                 |
| queryParams | Json   | ❌   | 查询参数                  |
| bodyParams  | Json   | ❌   | 请求体参数                |
| ipAddress   | String | ✅   | 客户端 IP 地址            |
| response    | Json   | ❌   | 响应数据                  |
| statusCode  | Int    | ✅   | HTTP 状态码               |

### 7.3 索引

- `requestID`: 唯一索引
- `userID`: 普通索引，用于查询用户操作历史
- `path`: 普通索引，用于统计 API 使用情况

### 7.4 示例数据

```json
{
  "id": "clx2222222222",
  "requestID": "550e8400-e29b-41d4-a716-446655440000",
  "userID": "clx1234567890",
  "path": "/api/users/me",
  "method": "GET",
  "queryParams": null,
  "bodyParams": null,
  "ipAddress": "192.168.1.100",
  "response": { "code": 0, "message": "success" },
  "statusCode": 200,
  "status": 1,
  "createTime": "2026-02-10T00:00:00.000Z",
  "updateTime": "2026-02-10T00:00:00.000Z"
}
```

## 8. 数据库操作

### 8.1 常用命令

```bash
# 生成 Prisma Client
pnpm run db:generate

# 推送模式变更到数据库（开发环境）
pnpm run db:push

# 创建迁移（开发环境）
pnpm run db:migrate:dev

# 运行迁移（生产环境）
pnpm run db:migrate

# 重置数据库
pnpm run db:migrate:reset

# 重置并填充种子数据
pnpm run db:migrate:reset-seed

# 填充种子数据
pnpm run db:seed
```

### 8.2 修改数据模型流程

1. 编辑 `prisma/schema.prisma`
2. 创建迁移：`pnpm run db:migrate:dev`
3. 输入迁移名称
4. Prisma 自动生成迁移文件并应用
5. 重新生成 Prisma Client

### 8.3 查看数据库

使用 Prisma Studio（图形化界面）：

```bash
pnpm exec prisma studio
```

访问 `http://localhost:5555`

## 9. 数据访问层 (Repository)

### 9.1 Repository 模式

所有数据库操作都通过 Repository 层进行：

```typescript
// src/store/user.repository.ts
export class UserRepository {
  private static instance: UserRepository;

  public static getInstance(): UserRepository {
    if (!UserRepository.instance) {
      UserRepository.instance = new UserRepository();
    }
    return UserRepository.instance;
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { username } });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  async delete(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { status: 0 },
    });
  }
}
```

### 9.2 软删除

项目使用软删除机制，不直接删除数据：

```typescript
// 软删除
await prisma.user.update({
  where: { id },
  data: { status: 0 },
});

// 查询时过滤已删除数据
await prisma.user.findMany({
  where: { status: 1 },
});
```

### 9.3 关联查询

```typescript
// 查询用户及其所属组
const user = await prisma.user.findUnique({
  where: { id },
  include: { group: true },
});

// 查询组及其所有用户
const group = await prisma.group.findUnique({
  where: { id },
  include: { users: true },
});
```

## 10. 数据迁移

### 10.1 迁移文件

迁移文件位于 `prisma/migrations/` 目录：

```
prisma/migrations/
├── 20260210000001_init/
│   └── migration.sql
├── 20260210000002_add_user_email/
│   └── migration.sql
└── migration_lock.toml
```

### 10.2 迁移示例

```sql
-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `createTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updateTime` DATETIME(3) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `password` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `permissionAdds` JSON NOT NULL,
    `permissionRemoves` JSON NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 10.3 回滚迁移

Prisma 不支持自动回滚，需要手动处理：

1. 删除最新的迁移文件
2. 手动编写回滚 SQL
3. 在数据库中执行回滚 SQL
4. 重新生成 Prisma Client

## 11. 数据种子

### 11.1 种子文件

位于 `prisma/seed.ts`，用于初始化数据：

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 创建管理员组
  const adminGroup = await prisma.group.create({
    data: {
      username: "admin_group",
      name: "管理员组",
      permissions: ["user:read", "user:create", "user:update"],
      level: 10,
    },
  });

  // 创建管理员用户
  await prisma.user.create({
    data: {
      username: "admin",
      name: "管理员",
      password: "5f4dcc3b5aa765d61d8327deb882cf99", // MD5("password")
      groupId: adminGroup.id,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### 11.2 运行种子

```bash
pnpm run db:seed
```

## 12. 性能优化

### 12.1 索引优化

- ✅ 为常用查询字段添加索引
- ✅ 唯一字段使用唯一索引
- ✅ 关联字段自动创建索引

### 12.2 查询优化

```typescript
// ❌ 避免 N+1 查询
const users = await prisma.user.findMany();
for (const user of users) {
  const group = await prisma.group.findUnique({ where: { id: user.groupId } });
}

// ✅ 使用 include 一次性加载
const users = await prisma.user.findMany({
  include: { group: true },
});
```

### 12.3 连接池

Prisma 自动管理连接池，默认配置：

- 最小连接数: 2
- 最大连接数: 10

可通过环境变量调整：

```
DATABASE_URL="mysql://user:password@localhost:3306/db?connection_limit=20"
```

## 13. 数据备份

### 13.1 备份命令

```bash
# 备份数据库
mysqldump -u username -p database_name > backup.sql

# 恢复数据库
mysql -u username -p database_name < backup.sql
```

### 13.2 定期备份

建议设置定时任务进行自动备份：

```bash
# crontab 示例（每天凌晨 2 点备份）
0 2 * * * mysqldump -u username -p password database_name > /backup/db_$(date +\%Y\%m\%d).sql
```

## 14. 安全建议

### 14.1 密码存储

- ❌ 当前使用 MD5（不安全）
- ✅ 建议升级为 bcrypt 或 argon2

```typescript
// 推荐方式
import bcrypt from "bcrypt";

const hashedPassword = await bcrypt.hash(password, 10);
const isValid = await bcrypt.compare(password, hashedPassword);
```

### 14.2 SQL 注入防护

- ✅ Prisma 自动防止 SQL 注入
- ✅ 使用参数化查询
- ❌ 避免使用原始 SQL（除非必要）

### 14.3 敏感数据

- ✅ 密码字段加密存储
- ✅ 不在日志中记录敏感信息
- ✅ 定期清理过期日志数据

## 15. 监控与维护

### 15.1 数据库监控

监控指标：

- 连接数
- 查询性能
- 慢查询日志
- 磁盘使用率

### 15.2 日志清理

定期清理 APILog 表：

```typescript
// 删除 30 天前的日志
await prisma.aPILog.deleteMany({
  where: {
    createTime: {
      lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  },
});
```

### 15.3 数据归档

对于历史数据，考虑归档到其他存储：

- 导出为 JSON/CSV
- 迁移到冷存储
- 使用数据仓库

## 16. 常见问题

### 16.1 迁移失败

**问题**: 运行迁移时出错

**解决**:

1. 检查数据库连接
2. 查看迁移文件是否有语法错误
3. 手动修复数据库状态
4. 重新运行迁移

### 16.2 Prisma Client 未更新

**问题**: 修改模型后代码提示不正确

**解决**:

```bash
pnpm run db:generate
```

### 16.3 连接池耗尽

**问题**: 出现 "Too many connections" 错误

**解决**:

1. 增加连接池大小
2. 检查是否有连接泄漏
3. 确保正确关闭连接

### 16.4 查询性能慢

**问题**: 某些查询执行缓慢

**解决**:

1. 添加适当的索引
2. 使用 `EXPLAIN` 分析查询
3. 优化查询逻辑
4. 考虑使用缓存
