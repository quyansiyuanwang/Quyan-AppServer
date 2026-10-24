import { afterEach } from "vitest";
import { clearRequestContext } from "@/util/request-context";

/**
 * 清理测试之间可能泄漏的请求上下文
 */
afterEach(async () => {
  clearRequestContext();
});

/**
 * 注意：不在这里使用全局 afterEach 清理数据
 * 因为不同的测试文件可能使用 beforeAll 创建数据，在多个测试中共享
 * 让每个测试文件自己管理数据清理（在 afterAll 中）
 */
