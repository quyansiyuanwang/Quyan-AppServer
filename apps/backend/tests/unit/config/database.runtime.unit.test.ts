import { beforeEach, describe, expect, it, vi } from "vitest";

describe("database runtime config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/util/logger", () => ({
      getLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn() })),
      LogCategory: { STORAGE: "STORAGE" },
    }));
    vi.restoreAllMocks();
  });

  it("creates PrismaClient with test-safe logging and DATABASE_URL datasource", async () => {
    const prismaInstance = { user: {}, $disconnect: vi.fn(), $on: vi.fn() };
    const PrismaClient = vi.fn(function PrismaClientMock() {
      return prismaInstance;
    });

    vi.doMock("@prisma/client", () => ({ PrismaClient }));
    vi.doMock("../../../src/config/env", () => ({
      env: {
        runtime: { isTest: true },
        database: { url: "mysql://root:password@localhost:3306/runtime_test" },
      },
    }));

    const module = await import("../../../src/config/database");

    expect(PrismaClient).toHaveBeenCalledWith({
      log: [],
      datasources: {
        db: {
          url: "mysql://root:password@localhost:3306/runtime_test",
        },
      },
    });
    expect(module.prisma).toBe(prismaInstance);
  });

  it("creates PrismaClient with event-only diagnostics outside test mode", async () => {
    const prismaInstance = { user: {}, $disconnect: vi.fn(), $on: vi.fn() };
    const PrismaClient = vi.fn(function PrismaClientMock() {
      return prismaInstance;
    });

    vi.doMock("@prisma/client", () => ({ PrismaClient }));
    vi.doMock("../../../src/config/env", () => ({
      env: {
        runtime: { isTest: false },
        database: { url: "mysql://root:password@localhost:3306/runtime_dev" },
      },
    }));

    await import("../../../src/config/database");

    expect(PrismaClient).toHaveBeenCalledWith({
      log: [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ],
      datasources: {
        db: {
          url: "mysql://root:password@localhost:3306/runtime_dev",
        },
      },
    });
  });
});
