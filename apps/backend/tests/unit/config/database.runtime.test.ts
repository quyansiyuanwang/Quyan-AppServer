import { beforeEach, describe, expect, it, vi } from "vitest";

describe("database runtime config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("creates PrismaClient with test-safe logging and DATABASE_URL datasource", async () => {
    const prismaInstance = { user: {}, $disconnect: vi.fn() };
    const PrismaClient = vi.fn(function PrismaClientMock() {
      return prismaInstance;
    });

    process.env.DATABASE_URL = "mysql://root:password@localhost:3306/runtime_test";

    vi.doMock("@prisma/client", () => ({ PrismaClient }));
    vi.doMock("../../../src/config/env", () => ({
      EnvSpace: {
        isTest: true,
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

  it("creates PrismaClient with warn/error logging outside test mode", async () => {
    const prismaInstance = { user: {}, $disconnect: vi.fn() };
    const PrismaClient = vi.fn(function PrismaClientMock() {
      return prismaInstance;
    });

    process.env.DATABASE_URL = "mysql://root:password@localhost:3306/runtime_dev";

    vi.doMock("@prisma/client", () => ({ PrismaClient }));
    vi.doMock("../../../src/config/env", () => ({
      EnvSpace: {
        isTest: false,
      },
    }));

    await import("../../../src/config/database");

    expect(PrismaClient).toHaveBeenCalledWith({
      log: ["warn", "error"],
      datasources: {
        db: {
          url: "mysql://root:password@localhost:3306/runtime_dev",
        },
      },
    });
  });
});
