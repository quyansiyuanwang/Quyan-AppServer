# 测试指南

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本项目使用 Vitest 作为测试框架，Supertest 进行 API 集成测试。测试采用独立的测试数据库，避免影响开发数据。

### 1.1 测试技术栈

- **测试框架**: Vitest 4.x
- **API 测试**: Supertest 7.x
- **Mock 工具**: vitest-mock-extended
- **覆盖率**: V8 Provider

## 2. 测试环境配置

### 2.1 测试环境变量

测试使用独立的环境变量文件 `.env.test`：

```env
NODE_ENV=test
PORT=10002
DATABASE_URL=mysql://<user>:<password>@localhost:3306/<test_db>
JWT_ACCESS_SECRET=test_access_secret
JWT_REFRESH_SECRET=test_refresh_secret
JWT_ACCESS_EXPIRES_IN=300
JWT_REFRESH_EXPIRES_IN=3600
```

**重要**: 测试数据库必须与开发数据库分离。

### 2.2 Vitest 配置

配置文件: `vitest.config.ts`

关键配置：

- `backend-unit`: 纯 Node 单测，不连接 MySQL 或 Redis，可并行。运行器会先生成 Prisma Client，供间接导入 Prisma 模块的测试加载；这不是数据库 bootstrap。
- `backend-database`: Prisma、Redis、HTTP 集成测试；每个 worker 使用独立的派生 MySQL 库及 Redis DB。
- `backend-contract`: 仅 schema 合约检查使用 Node；需要运行时数据的 operation 合约在数据库项目中执行。
- `mockReset: true`: 每次测试后重置 mock。

### 2.3 测试数据库初始化

数据库测试在运行前自动初始化：

```bash
# 纯单测：不连接基础设施
pnpm run test:unit

# 所有数据库、集成和运行时 contract 测试
pnpm run test:runtime

# 清理中断测试遗留的派生数据库
pnpm run test:db:clean
```

`DATABASE_URL` 必须指向名称含 `test` 的专用基础库，测试帐号必须拥有该基础库同服务器上的 `CREATE/DROP DATABASE` 权限。每次运行使用随机命名空间创建 `<base>__vitest_<run>_<worker>`，结束时自动删除；不会重置基础库本身。每个数据库文件开始前，worker 以单次批量 SQL 清空其派生库，避免逐表清理在并发时发生 hook 超时。`TEST_DB_WORKERS` 控制数据库 worker 数，`TEST_REDIS_DB_BASE` 指定 Redis 逻辑库起点，二者默认保守限制在 Redis 的 16 个逻辑库范围内。CI 固定 `TEST_DB_WORKERS=2` 并设置 `TEST_REDIS_REQUIRED=true`，因此 Redis 不可用会立即失败且每个文件会清空自己的 Redis DB；本地只有设置 `TEST_REDIS_CLEANUP=true` 才连接 Redis，避免未启动 Redis 的开发环境拖慢不依赖它的持久化测试。

## 3. 运行测试

### 3.1 运行所有测试

```bash
pnpm run test
```

按范围运行：

```bash
pnpm run test:unit         # 纯 mock/逻辑测试
pnpm run test:database     # Prisma 持久化测试
pnpm run test:integration  # HTTP、Redis 和流程集成测试
pnpm run test:contract     # OpenAPI schema 与 operation contract
pnpm run test:runtime      # database + contract
```

### 3.2 监听模式

```bash
pnpm run test:watch
```

文件变化时自动重新运行相关测试。

### 3.3 UI 模式

```bash
pnpm run test:ui
```

在浏览器中打开交互式测试界面。

### 3.4 生成覆盖率报告

```bash
pnpm run test:coverage
```

覆盖率报告生成在 `coverage/` 目录：

- `coverage/index.html`: HTML 报告
- `coverage/coverage-final.json`: JSON 报告

## 4. 测试结构

### 4.1 目录结构

```
tests/
├── unit/                   # *.unit.test.ts，纯 Node/mocked tests
├── database/               # *.db.test.ts，直接 Prisma 持久化 tests
├── integration/            # *.integration.test.ts，HTTP/Redis/API tests
├── contract/               # *.contract.test.ts，OpenAPI tests
├── runtime/                # worker 数据库与 Redis 隔离
├── scripts/                # 运行器、清理与分类校验
└── util/                   # 测试辅助工具
```

### 4.2 测试文件命名

- 纯单元测试: `*.unit.test.ts`
- 数据库测试: `*.db.test.ts`
- 集成测试: `*.integration.test.ts`
- 合约测试: `*.contract.test.ts`

## 5. API 测试

### 5.1 基本结构

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "@/app";

describe("Auth API", () => {
  const app = createApp();

  describe("POST /auth/login", () => {
    it("should login successfully with valid credentials", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "admin",
        password: "password123",
      });

      expect(response.status).toBe(200);
      expect(response.body.code).toBe(0);
      expect(response.body.data).toHaveProperty("access_token");
      expect(response.body.data).toHaveProperty("refresh_token");
    });

    it("should fail with invalid credentials", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "admin",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
      expect(response.body.code).not.toBe(0);
    });
  });
});
```

### 5.2 认证测试

对于需要认证的接口，先获取 token：

```typescript
describe("Protected API", () => {
  const app = createApp();
  let accessToken: string;

  beforeAll(async () => {
    // 登录获取 token
    const loginResponse = await request(app).post("/auth/login").send({
      username: "admin",
      password: "password123",
    });

    accessToken = loginResponse.body.data.access_token;
  });

  it("should access protected endpoint with token", async () => {
    const response = await request(app).get("/users/me").set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
  });

  it("should fail without token", async () => {
    const response = await request(app).get("/users/me");

    expect(response.status).toBe(401);
  });
});
```

### 5.3 测试数据准备

使用 `beforeEach` 和 `afterEach` 管理测试数据：

```typescript
import { prisma } from "@/util/prisma";

describe("User API", () => {
  let testUserId: string;

  beforeEach(async () => {
    // 创建测试数据
    const user = await prisma.user.create({
      data: {
        username: "testuser",
        password: "hashedpassword",
        name: "Test User",
      },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    // 清理测试数据
    await prisma.user.delete({
      where: { id: testUserId },
    });
  });

  it("should get user by id", async () => {
    // 测试逻辑
  });
});
```

## 6. 单元测试

### 6.1 Service 层测试

```typescript
import { describe, it, expect, vi } from "vitest";
import { UserService } from "@/services/user.service";
import { UserRepository } from "@/store/user.repository";

// Mock Repository
vi.mock("@/store/user.repository");

describe("UserService", () => {
  it("should get user by id", async () => {
    const mockUser = {
      id: "123",
      username: "testuser",
      name: "Test User",
    };

    // 设置 mock 返回值
    vi.mocked(UserRepository.getInstance().findById).mockResolvedValue(mockUser);

    const service = new UserService();
    const result = await service.getUserById("123");

    expect(result).toEqual(mockUser);
    expect(UserRepository.getInstance().findById).toHaveBeenCalledWith("123");
  });
});
```

### 6.2 工具函数测试

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/util/crypto";

describe("Crypto Utils", () => {
  describe("hashPassword", () => {
    it("should hash password correctly", () => {
      const password = "password123";
      const hashed = hashPassword(password);

      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
    });
  });

  describe("verifyPassword", () => {
    it("should verify correct password", () => {
      const password = "password123";
      const hashed = hashPassword(password);

      expect(verifyPassword(password, hashed)).toBe(true);
    });

    it("should reject incorrect password", () => {
      const password = "password123";
      const hashed = hashPassword(password);

      expect(verifyPassword("wrongpassword", hashed)).toBe(false);
    });
  });
});
```

## 7. Mock 技巧

### 7.1 Mock 模块

```typescript
import { vi } from "vitest";

// Mock 整个模块
vi.mock("@/util/logger", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
```

### 7.2 Mock 函数

```typescript
import { vi } from "vitest";

const mockFn = vi.fn();

// 设置返回值
mockFn.mockReturnValue("result");

// 设置异步返回值
mockFn.mockResolvedValue("async result");

// 设置抛出错误
mockFn.mockRejectedValue(new Error("error"));

// 验证调用
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");
expect(mockFn).toHaveBeenCalledTimes(1);
```

### 7.3 Mock Prisma

```typescript
import { vi } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";

const prismaMock = mockDeep<PrismaClient>();

vi.mock("@/util/prisma", () => ({
  prisma: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
});

// 在测试中使用
prismaMock.user.findUnique.mockResolvedValue({
  id: "123",
  username: "testuser",
});
```

## 8. 测试最佳实践

### 8.1 测试命名

使用描述性的测试名称：

```typescript
// ✅ 好的命名
it("should return 401 when token is expired", async () => {});
it("should create user with valid data", async () => {});

// ❌ 不好的命名
it("test1", async () => {});
it("works", async () => {});
```

### 8.2 AAA 模式

遵循 Arrange-Act-Assert 模式：

```typescript
it("should calculate total correctly", () => {
  // Arrange: 准备测试数据
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 },
  ];

  // Act: 执行操作
  const total = calculateTotal(items);

  // Assert: 验证结果
  expect(total).toBe(35);
});
```

### 8.3 独立性

每个测试应该独立，不依赖其他测试：

```typescript
// ✅ 好的做法
describe("User API", () => {
  beforeEach(async () => {
    // 每个测试前创建数据
    await createTestUser();
  });

  afterEach(async () => {
    // 每个测试后清理数据
    await cleanupTestUser();
  });
});

// ❌ 不好的做法
describe("User API", () => {
  it("should create user", async () => {
    // 创建用户
  });

  it("should get user", async () => {
    // 依赖上一个测试创建的用户
  });
});
```

### 8.4 测试覆盖

重点测试：

- ✅ 核心业务逻辑
- ✅ 边界条件
- ✅ 错误处理
- ✅ 权限控制
- ❌ 不要过度测试简单的 getter/setter

### 8.5 异步测试

正确处理异步操作：

```typescript
// ✅ 使用 async/await
it("should fetch data", async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
});

// ❌ 忘记 await
it("should fetch data", async () => {
  const data = fetchData(); // 返回 Promise，不是实际数据
  expect(data).toBeDefined(); // 错误的断言
});
```

## 9. 常见测试场景

### 9.1 测试错误处理

```typescript
it("should throw error when user not found", async () => {
  await expect(service.getUserById("nonexistent")).rejects.toThrow("User not found");
});
```

### 9.2 测试权限

```typescript
it("should deny access without permission", async () => {
  const response = await request(app).get("/admin/users").set("Authorization", `Bearer ${userToken}`);

  expect(response.status).toBe(403);
  expect(response.body.code).toBe(1002); // 权限不足
});
```

### 9.3 测试参数验证

```typescript
it("should reject invalid email format", async () => {
  const response = await request(app).post("/users").send({
    username: "testuser",
    email: "invalid-email", // 无效邮箱
  });

  expect(response.status).toBe(422);
});
```

### 9.4 测试分页

```typescript
it("should return paginated results", async () => {
  const response = await request(app).get("/users?page=1&pageSize=10").set("Authorization", `Bearer ${token}`);

  expect(response.body.data.items).toHaveLength(10);
  expect(response.body.data).toHaveProperty("total");
  expect(response.body.data).toHaveProperty("page");
});
```

## 10. 调试测试

### 10.1 运行单个测试文件

```bash
pnpm run test:integration -- tests/integration/<name>.integration.test.ts
```

### 10.2 运行特定测试

使用 `.only`:

```typescript
it.only("should run only this test", async () => {
  // 只运行这个测试
});
```

### 10.3 跳过测试

使用 `.skip`:

```typescript
it.skip("should skip this test", async () => {
  // 跳过这个测试
});
```

### 10.4 查看详细输出

```bash
pnpm run test:unit -- --reporter=verbose
```

## 11. 持续集成

CI 定义在仓库根目录 `.github/workflows/test-backend.yml`。它通过 paths filter 区分普通源码、API 表面和测试基础设施变更：纯单测在独立 job 中运行；运行时 job 提供 MySQL/Redis service，固定两个数据库 worker，并运行数据库与 contract 测试。相关测试无法可靠覆盖配置、Prisma、共享包或测试 runtime 变更时，CI 会升级为完整受影响套件。完整策略见仓库级 [测试与 CI 文档](../../../../docs/development/11-testing-and-ci.md)。

## 12. 性能测试

### 12.1 测试响应时间

```typescript
it("should respond within 100ms", async () => {
  const start = Date.now();

  await request(app).get("/api/fast-endpoint");

  const duration = Date.now() - start;
  expect(duration).toBeLessThan(100);
});
```

### 12.2 负载测试

考虑使用专门的负载测试工具：

- Apache JMeter
- k6
- Artillery

## 13. 常见问题

### 13.1 测试数据库连接失败

**解决**:

1. 检查 `.env.test` 中的基础 `DATABASE_URL` 名称包含 `test`
2. 确认测试账户拥有 `CREATE/DROP DATABASE` 权限
3. 确保 MySQL 服务运行中；需要 Redis 严格隔离时确认 Redis 可用
4. 中断测试后运行 `pnpm run test:db:clean` 回收派生数据库

### 13.2 测试超时

**解决**:

```typescript
it("should complete long operation", async () => {
  // 增加超时时间
}, 10000); // 10 秒
```

### 13.3 Mock 不生效

**解决**:

1. 确保 mock 在导入模块之前
2. 使用 `vi.mock()` 而不是手动赋值
3. 检查 mock 路径是否正确

### 13.4 测试数据污染

**解决**:

1. 确认测试位于 `database`、`integration` 或 runtime contract 分类
2. 不要将 fixture 写入基础测试库；worker 会在每个文件开始前清空自己的派生库
3. 中断测试后运行 `pnpm run test:db:clean`

## 14. 测试清单

在提交代码前，确保：

- [ ] 所有测试通过
- [ ] 新功能有对应测试
- [ ] 测试覆盖率达标（建议 > 80%）
- [ ] 没有跳过的测试（除非有充分理由）
- [ ] 测试数据已清理
- [ ] 没有硬编码的测试数据
