import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }));
vi.mock("@/store/system/businesslog", () => ({
  BusinessLogRepository: { getInstance: () => ({ create: mocks.create }) },
}));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: () => ({}) } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ error: mocks.error }), LogCategory: { BUSINESS: "business" } }));
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
const input = {
  operationType: OperationType.RELAY_CHANNEL_UPDATE,
  operationCategory: OperationCategory.RELAY,
  actorUserId: "actor",
  description: "Updated authorized configuration",
  success: true,
  ipAddress: "192.0.2.1",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "log" });
});
describe("business audit transaction contract", () => {
  it("passes the exact caller transaction to the repository", async () => {
    const tx = {} as Prisma.TransactionClient;
    await BusinessLogService.getInstance().logOperation(input, tx);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining(input), tx);
  });
  it("propagates transactional failure without writing raw error parameters to logs", async () => {
    const failure = new Error("fixture-secret raw storage error"),
      tx = {} as Prisma.TransactionClient;
    mocks.create.mockRejectedValue(failure);
    await expect(BusinessLogService.getInstance().logOperation(input, tx)).rejects.toBe(failure);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it("preserves existing best-effort behavior for nontransactional callers", async () => {
    mocks.create.mockRejectedValue(new Error("unavailable"));
    await expect(BusinessLogService.getInstance().logOperation(input)).resolves.toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining(input), undefined);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });
});
