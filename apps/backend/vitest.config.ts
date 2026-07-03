import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnvFile } from "process";
import tsconfigPaths from "vite-tsconfig-paths";

// 加载测试环境变量
loadEnvFile(".env.test");

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    env: {
      NODE_ENV: "test",
    },
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // 接口测试按顺序运行(避免数据库并发冲突)
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "tests/", "**/*.d.ts", "**/*.config.*", "**/mockData/**"],
    },
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, "./src")}/$1` },
      { find: /^@src\/(.*)$/, replacement: `${path.resolve(__dirname, "./src")}/$1` },
      { find: /^@logs\/(.*)$/, replacement: `${path.resolve(__dirname, "./logs")}/$1` },
      { find: /^@logs_ignore\/(.*)$/, replacement: `${path.resolve(__dirname, "./logs_ignore")}/$1` },
      { find: /^@public\/(.*)$/, replacement: `${path.resolve(__dirname, "./public")}/$1` },
      { find: /^@publicStatic\/(.*)$/, replacement: `${path.resolve(__dirname, "./publicStatic")}/$1` },
      { find: "@src", replacement: path.resolve(__dirname, "./src") },
      { find: "@logs", replacement: path.resolve(__dirname, "./logs") },
      { find: "@logs_ignore", replacement: path.resolve(__dirname, "./logs_ignore") },
      { find: "@public", replacement: path.resolve(__dirname, "./public") },
      { find: "@publicStatic", replacement: path.resolve(__dirname, "./publicStatic") },
    ],
  },
});
