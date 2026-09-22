import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  relayChannelProviderRevenue: { getInstance: vi.fn() },
}));

vi.mock("../../../src/config/database", () => ({
  prisma: { $transaction: mocks.transaction },
}));

vi.mock("../../../src/services/relay/relay-channel-provider-revenue.service", () => ({
  RelayChannelProviderRevenueService: mocks.relayChannelProviderRevenue,
}));

/**
 * 这两个用例在 `beforeEach` 里 `vi.resetModules()` 后动态 import 仓储模块，
 * 以拿到全新的单例；该模块的依赖图很大，**首次求值在整套并行运行时可能远超默认 5s**。
 * 曾因此出现「用例 1 超时 → 其重试循环仍在飞行 → 用例 2 的 `$transaction` 计数被污染为 10」。
 * 因此这里显式放宽超时：慢的是模块求值，不是被测逻辑（隔离运行约 0.3s）。
 */
const MODULE_EVAL_TIMEOUT_MS = 30_000;

describe("RelayProxyRepository", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.relayChannelProviderRevenue.getInstance.mockReturnValue({});
  });

  it(
    "retries charged usage after a Prisma write conflict",
    async () => {
      const writeConflict = Object.assign(new Error("deadlock"), { code: "P2034" });
      mocks.transaction.mockRejectedValueOnce(writeConflict).mockResolvedValueOnce({
        applied: true,
        notifyContext: undefined,
      });

      const { RelayProxyRepository } = await import("../../../src/store/relay/relay-proxy.repository");
      const repository = RelayProxyRepository.getInstance();

      await expect(repository.finalizeChargedUsage({} as any)).resolves.toEqual({ applied: true });
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
    },
    MODULE_EVAL_TIMEOUT_MS,
  );

  it(
    "returns a retryable lock conflict when the transaction remains contested",
    async () => {
      const writeConflict = Object.assign(new Error("deadlock"), { code: "P2034" });
      mocks.transaction.mockRejectedValue(writeConflict);

      const { RelayProxyRepository } = await import("../../../src/store/relay/relay-proxy.repository");
      // 必须与仓储来自同一个（resetModules 之后的）模块注册表，否则 `instanceof` 会因
      // 类身份不同而失败——不要改为顶层静态导入。
      const { ResourceLockedError } = await import("../../../src/util/errors");
      const repository = RelayProxyRepository.getInstance();

      const error = await repository.finalizeChargedUsage({} as any).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(ResourceLockedError);
      expect(error).toMatchObject({ retryAfter: 1 });
      // 每次尝试调用一次 `$transaction`，共 RELAY_TRANSACTION_MAX_ATTEMPTS 次
      expect(mocks.transaction).toHaveBeenCalledTimes(5);
    },
    MODULE_EVAL_TIMEOUT_MS,
  );
});
