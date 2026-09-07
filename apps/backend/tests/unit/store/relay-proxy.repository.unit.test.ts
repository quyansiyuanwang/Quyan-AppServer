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

describe("RelayProxyRepository", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.relayChannelProviderRevenue.getInstance.mockReturnValue({});
  });

  it("retries charged usage after a Prisma write conflict", async () => {
    const writeConflict = Object.assign(new Error("deadlock"), { code: "P2034" });
    mocks.transaction.mockRejectedValueOnce(writeConflict).mockResolvedValueOnce({
      applied: true,
      notifyContext: undefined,
    });

    const { RelayProxyRepository } = await import("../../../src/store/relay/relay-proxy.repository");
    const repository = RelayProxyRepository.getInstance();

    await expect(repository.finalizeChargedUsage({} as any)).resolves.toEqual({ applied: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("returns a retryable lock conflict when the transaction remains contested", async () => {
    const writeConflict = Object.assign(new Error("deadlock"), { code: "P2034" });
    mocks.transaction.mockRejectedValue(writeConflict);

    const { RelayProxyRepository } = await import("../../../src/store/relay/relay-proxy.repository");
    const { ResourceLockedError } = await import("../../../src/util/errors");
    const repository = RelayProxyRepository.getInstance();

    const error = await repository.finalizeChargedUsage({} as any).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ResourceLockedError);
    expect(error).toMatchObject({ retryAfter: 1 });
    expect(mocks.transaction).toHaveBeenCalledTimes(5);
  });
});
