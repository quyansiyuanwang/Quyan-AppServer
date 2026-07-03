import { describe, it, expect } from "vitest";
import { truncateContent } from "@/util/logger-decorator";
import { LOG_TRUNCATE_CONFIG } from "@/util/logger";

describe("日志增强功能测试", () => {
  describe("truncateContent - 内容截断", () => {
    it("应该截断长字符串", () => {
      const longString = "a".repeat(1000);
      const result = truncateContent(longString, 100);
      expect(result).toContain(LOG_TRUNCATE_CONFIG.truncateSuffix);
      expect(result).toContain("原长度: 1000");
      expect(result.length).toBeLessThan(longString.length);
    });

    it("应该保留短字符串", () => {
      const shortString = "hello world";
      const result = truncateContent(shortString, 100);
      expect(result).toBe(shortString);
    });

    it("应该截断长对象", () => {
      const longObject = {
        field1: "a".repeat(1000),
        field2: "b".repeat(1000),
      };
      const result = truncateContent(longObject, 100);
      expect(typeof result).toBe("string");
      expect(result).toContain(LOG_TRUNCATE_CONFIG.truncateSuffix);
    });

    it("应该处理 null 和 undefined", () => {
      expect(truncateContent(null, 100)).toBe("");
      expect(truncateContent(undefined, 100)).toBe("");
    });

    it("应该处理数组", () => {
      const arr = Array(20).fill("item");
      const result = truncateContent(arr, 100);
      expect(typeof result).toBe("string");
    });
  });

  describe("LOG_TRUNCATE_CONFIG - 配置", () => {
    it("应该有正确的默认配置", () => {
      expect(LOG_TRUNCATE_CONFIG.maxFieldLength).toBe(1000);
      expect(LOG_TRUNCATE_CONFIG.maxContextLength).toBe(5000);
      expect(LOG_TRUNCATE_CONFIG.enabled).toBe(true);
    });
  });
});
