import { beforeEach } from "vitest";

/**
 * 每个测试文件运行前的设置
 */
beforeEach(async () => {
  // 可以在这里添加每个测试前的初始化逻辑
});

/**
 * 注意：不在这里使用全局 afterEach 清理数据
 * 因为不同的测试文件可能使用 beforeAll 创建数据，在多个测试中共享
 * 让每个测试文件自己管理数据清理（在 afterAll 中）
 */
