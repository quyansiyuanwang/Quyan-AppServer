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

- `fileParallelism: false`: 禁用并行测试，避免数据库并发冲突
- `globalSetup`: 全局设置文件 `tests/globalSetup.ts`
- `setupFiles`: 测试设置文件 `tests/setup.ts`
- `mockReset: true`: 每次测试后重置 mock

### 2.3 测试数据库初始化

在运行测试前，需要初始化测试数据库：

```bash
# 使用测试环境变量
export $(cat .env.test | xargs)

# 推送模型到测试数据库
pnpm run db:push

# 或使用迁移
pnpm run db:migrate

# 填充测试数据
pnpm run db:seed
```

## 3. 运行测试

### 3.1 运行所有测试

```bash
pnpm run test
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
├── globalSetup.ts          # 全局设置
├── setup.ts                # 测试设置
├── api/                    # API 测试
│   ├── auth.test.ts        # 认证接口测试
│   ├── user.test.ts        # 用户接口测试
│   └── permission.test.ts  # 权限接口测试
├── services/               # 服务层测试
├── store/                  # 仓储层测试
└── utils/                  # 工具函数测试
```

### 4.2 测试文件命名

- 单元测试: `*.test.ts`
- 集成测试: `*.integration.test.ts`
- E2E 测试: `*.e2e.test.ts`

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
pnpm exec vitest run tests/api/auth.test.ts
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
pnpm exec vitest run --reporter=verbose
```

## 11. 持续集成

### 11.1 CI 配置示例

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: test_db
        ports:
          - 3306:3306

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
      - run: pnpm install
      - run: pnpm run db:push
      - run: pnpm run test
      - run: pnpm run test:coverage
```

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

1. 确认测试数据库已创建
2. 检查 `.env.test` 中的 `DATABASE_URL`
3. 确保 MySQL 服务运行中

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

1. 使用事务回滚
2. 在 `afterEach` 中清理数据
3. 使用独立的测试数据库

## 14. 测试清单

在提交代码前，确保：

- [ ] 所有测试通过
- [ ] 新功能有对应测试
- [ ] 测试覆盖率达标（建议 > 80%）
- [ ] 没有跳过的测试（除非有充分理由）
- [ ] 测试数据已清理
- [ ] 没有硬编码的测试数据
