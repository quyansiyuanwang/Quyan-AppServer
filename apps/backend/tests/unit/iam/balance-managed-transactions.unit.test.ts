vi.mock("@/services/billing/balance-transaction-iam.service", () => ({
  BalanceTransactionIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/iam-account-user-mutation.service", () => ({
  IamAccountUserMutationService: { getInstance: vi.fn() },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mode: "enforce", warn: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/store/billing/balance.repository", () => ({ BalanceRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/iam-account-user-authorization.service", () => ({
  IamAccountUserAuthorizationService: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: mocks.warn }), LogCategory: { SECURITY: "security" } }));
import { BalanceService } from "@/services/billing/balance.service";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
let service: BalanceService, repository: any, iam: any, permissions: any, request: TypedRequest, transactions: any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "enforce";
  repository = {
    findAccountByUserId: vi.fn().mockResolvedValue({ id: "balance", userId: "peer", balance: 15 }),
    findAccountsByUserIds: vi.fn().mockResolvedValue([{ id: "balance", userId: "peer", balance: 15 }]),
  };
  iam = {
    read: vi
      .fn()
      .mockImplementation(
        async (_action: string, id: string, _request: unknown, read: (id: string) => Promise<unknown>) => read(id),
      ),
    readMany: vi
      .fn()
      .mockImplementation(
        async (_action: string, ids: string[], _request: unknown, read: (ids: string[]) => Promise<unknown>) =>
          read(ids),
      ),
    authorize: vi.fn(),
    authorizeMany: vi.fn(),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
    headers: {},
  } as unknown as TypedRequest;
  transactions = { list: vi.fn().mockResolvedValue({ records: [], total: 0, page: 1, pageSize: 20, display: {} }) };
  repository.findTransactions = vi.fn().mockResolvedValue({ records: [], total: 7 });
  service = new (BalanceService as unknown as new (...args: any[]) => BalanceService)(
    repository,
    {},
    iam,
    permissions,
    undefined,
    transactions,
  );
});
describe("managed transaction rollout", () => {
  const query = { page: 1, pageSize: 20 };
  it("enforce reads through the row evaluator instead of the legacy global query", async () => {
    await service.getManagedTransactions(query, request);
    expect(transactions.list).toHaveBeenCalledWith(query, request);
    expect(repository.findTransactions).not.toHaveBeenCalled();
  });
  it("enforce never falls back when the evaluator fails", async () => {
    transactions.list.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.getManagedTransactions(query, request)).rejects.toThrow("fixture unavailable");
    expect(repository.findTransactions).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])("%s still requires legacy permission in the role session", async (mode) => {
    mocks.mode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.getManagedTransactions(query, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findTransactions).not.toHaveBeenCalled();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.BALANCE_READ], {
      assumedRoleSessionId: "session",
    });
  });
  it("shadow evaluates metadata only and performs the original read exactly once", async () => {
    mocks.mode = "shadow";
    transactions.list.mockRejectedValue(new Error("private policy/balance"));
    expect((await service.getManagedTransactions(query, request)).total).toBe(7);
    expect(transactions.list).toHaveBeenCalledWith(query, request, true);
    expect(repository.findTransactions).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private policy/balance");
  });
});
