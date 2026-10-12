vi.mock("@/services/users/iam-account-user-mutation.service", () => ({
  IamAccountUserMutationService: { getInstance: vi.fn() },
}));
import { readFileSync } from "node:fs";
import { Project } from "ts-morph";
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
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
let service: BalanceService,
  repository: any,
  iam: any,
  permissions: any,
  request: TypedRequest,
  mutations: any,
  users: any;
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
  mutations = { prepare: vi.fn().mockResolvedValue({ targetUserId: "peer", users: [], recheck: vi.fn() }) };
  repository.recharge = vi.fn().mockResolvedValue({ userId: "peer", balance: 20 });
  users = { findById: vi.fn().mockResolvedValue({ id: "peer" }) };
  service = new (BalanceService as unknown as new (...args: any[]) => BalanceService)(
    repository,
    users,
    iam,
    permissions,
    mutations,
  );
});
describe("managed recharge rollout", () => {
  it("passes a trusted mutation guard and statistics flag to the existing money repository", async () => {
    expect(await service.rechargeManaged("peer", 20, "fixture", true, request)).toMatchObject({ userId: "peer" });
    expect(mutations.prepare).toHaveBeenCalledWith("quyan:balance:RechargeUserBalance", "peer", request);
    expect(repository.recharge).toHaveBeenCalledWith({
      userId: "peer",
      amount: 20,
      description: "fixture",
      countAsStatistics: true,
      iamGuard: expect.objectContaining({ targetUserId: "peer" }),
    });
    expect(users.findById).not.toHaveBeenCalled();
  });
  it("does not enter the money repository when IAM denies", async () => {
    mutations.prepare.mockRejectedValue(new Error("fixture denied"));
    await expect(service.rechargeManaged("peer", -5, undefined, false, request)).rejects.toThrow("fixture denied");
    expect(repository.recharge).not.toHaveBeenCalled();
    expect(permissions.checkUserPermissions).not.toHaveBeenCalled();
  });
  it.each([0, NaN, Infinity, -Infinity])(
    "rejects invalid money input %s before authorization or writes",
    async (amount) => {
      await expect(service.rechargeManaged("peer", amount, undefined, false, request)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repository.recharge).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"])(
    "%s checks the separate recharge permission in the active role session",
    async (mode) => {
      mocks.mode = mode;
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.rechargeManaged("peer", 5, undefined, false, request)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.BALANCE_RECHARGE], {
        assumedRoleSessionId: "session",
      });
      expect(repository.recharge).not.toHaveBeenCalled();
    },
  );
  it("shadow retains one legacy mutation and never logs private diagnostic errors", async () => {
    mocks.mode = "shadow";
    mutations.prepare.mockRejectedValue(new Error("private balance/policy document"));
    await service.rechargeManaged("peer", 5, "fixture", false, request);
    expect(repository.recharge).toHaveBeenCalledExactlyOnceWith({
      userId: "peer",
      amount: 5,
      description: "fixture",
      countAsStatistics: false,
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private balance/policy document");
  });
  it("declares a fixed user resource Action and preserves 2FA, replay and body validation", () => {
    const file = "src/api/controllers/v1/billing/balance.controller.ts",
      project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const route = collectIamRoutes([source], "/backend").find((r) => r.method === "recharge");
    expect(route).toMatchObject({
      coverage: "explicit",
      resourceKind: "single-resource",
      actions: ["quyan:balance:RechargeUserBalance"],
      issues: [],
    });
    const method = source.getClassOrThrow("BalanceController").getMethodOrThrow("recharge");
    expect(method.getDecorator("TwoFactorChallengeProtected")).toBeDefined();
    const middleware = method.getDecorator("Middlewares")?.getText();
    expect(middleware).toContain("twoFactorChallengeMiddleware");
    expect(middleware).toContain("replayProtectionMiddleware");
    expect(middleware).toContain("validateBody(rechargeBodySchema)");
  });
});
