import path from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { getDatabaseWorkerCount } from "./tests/runtime/test-worker-environment";

loadEnvFile(".env.test");

function includesForScope(name: string, include: string[]): string[] {
  const scope = process.env.APPSERVER_TEST_SCOPE;
  if (!scope) return include;

  if (scope === "database" && name === "backend-database") return ["tests/database/**/*.test.ts"];
  if (scope === "integration" && name === "backend-database") return ["tests/integration/**/*.test.ts"];
  if (scope === "contract") {
    if (name === "backend-database") return ["tests/contract/openapi-operations.contract.test.ts"];
    if (name === "backend-contract") return ["tests/contract/openapi-schema.contract.test.ts"];
  }

  return [];
}

export function defineBackendTestProject(name: string, include: string[], database = false) {
  const groupOrder = name === "backend-unit" ? 0 : name === "backend-database" ? 1 : 2;
  const generatedRouteAliases =
    name === "backend-unit"
      ? [
          { find: "@/build/route-paths", replacement: path.resolve(__dirname, "./tests/stubs/route-paths.ts") },
          { find: "@/build/routes", replacement: path.resolve(__dirname, "./tests/stubs/routes.ts") },
        ]
      : [];

  return defineConfig({
    plugins: [tsconfigPaths()],
    test: {
      name,
      globals: true,
      environment: "node",
      include: includesForScope(name, include),
      exclude: ["dist/**", "node_modules/**"],
      sequence: { groupOrder },
      env: { NODE_ENV: "test" },
      setupFiles: database ? ["./tests/runtime/database-worker.setup.ts"] : ["./tests/setup.ts"],
      ...(database ? { hookTimeout: 60_000 } : {}),
      ...(database
        ? {
            globalSetup: ["./tests/runtime/database-global-setup.ts"],
            minWorkers: getDatabaseWorkerCount(),
            maxWorkers: getDatabaseWorkerCount(),
          }
        : {}),
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
        ...generatedRouteAliases,
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
}
