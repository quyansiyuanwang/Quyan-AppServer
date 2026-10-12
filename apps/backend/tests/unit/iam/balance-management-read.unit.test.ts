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
import { getIamActionDefinition, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
let service: BalanceService, repository: any, iam: any, permissions: any, request: TypedRequest;
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
  service = new (BalanceService as unknown as new (...args: any[]) => BalanceService)(repository, {}, iam, permissions);
});
describe("managed balance read rollout", () => {
  it("requires a sensitive registered user resource Action, distinct from own balance access", () => {
    expect(getIamActionDefinition("quyan:balance:GetUserBalance")).toMatchObject({
      sensitive: true,
      resourceTypes: ["quyan/user"],
      legacyPermission: Permission.BALANCE_READ,
    });
    expect(getIamActionDefinition("quyan:balance:GetUserBalance")?.defaultAuthorizationScope).toBeUndefined();
  });
  it("reads only the target authorized by the user read boundary", async () => {
    expect(await service.getManagedBalance("peer", request)).toMatchObject({ userId: "peer", balance: 15 });
    expect(iam.read).toHaveBeenCalledWith("quyan:balance:GetUserBalance", "peer", request, expect.any(Function));
    expect(repository.findAccountByUserId).toHaveBeenCalledWith("peer");
  });
  it("retains zero balance for an authorized user whose account is uninitialized without creating anything", async () => {
    repository.findAccountByUserId.mockResolvedValue(null);
    expect(Number((await service.getManagedBalance("peer", request)).balance)).toBe(0);
  });
  it("authorizes the whole batch before any account hydration", async () => {
    expect(await service.getManagedBatchBalances(["peer", "actor"], request)).toEqual([
      { id: "balance", userId: "peer", balance: 15 },
      null,
    ]);
    expect(iam.readMany).toHaveBeenCalledWith(
      "quyan:balance:GetUserBalance",
      ["peer", "actor"],
      request,
      expect.any(Function),
    );
    expect(repository.findAccountsByUserIds).toHaveBeenCalledWith(["peer", "actor"]);
  });
  it("enforce authorization failures do not fall back or read balances", async () => {
    iam.read.mockRejectedValue(new Error("fixture denial"));
    iam.readMany.mockRejectedValue(new Error("fixture denial"));
    await expect(service.getManagedBalance("peer", request)).rejects.toThrow("fixture denial");
    await expect(service.getManagedBatchBalances(["peer"], request)).rejects.toThrow("fixture denial");
    expect(repository.findAccountByUserId).not.toHaveBeenCalled();
    expect(repository.findAccountsByUserIds).not.toHaveBeenCalled();
  });
  it("refuses a single account record bound to another user", async () => {
    repository.findAccountByUserId.mockResolvedValue({ id: "foreign-balance", userId: "foreign", balance: 999 });
    await expect(service.getManagedBalance("peer", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"])(
    "%s checks legacy permissions in the current role session before reading",
    async (mode) => {
      mocks.mode = mode;
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.getManagedBalance("peer", request)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.getManagedBatchBalances(["peer"], request)).rejects.toMatchObject({ statusCode: 403 });
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.BALANCE_READ], {
        assumedRoleSessionId: "session",
      });
      expect(repository.findAccountsByUserIds).not.toHaveBeenCalled();
    },
  );
  it("shadow performs diagnostics without a second balance read or sensitive error logging", async () => {
    mocks.mode = "shadow";
    iam.authorizeMany.mockRejectedValue(new Error("private balance/policy"));
    await service.getManagedBatchBalances(["peer"], request);
    expect(repository.findAccountsByUserIds).toHaveBeenCalledTimes(1);
    expect(iam.readMany).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private balance/policy");
  });
  it("declares a fixed user Action for single and batch APIs while retaining replay validation", () => {
    const file = "src/api/controllers/v1/billing/balance.controller.ts",
      project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const routes = collectIamRoutes([source], "/backend").filter((r) =>
      r.actions.includes("quyan:balance:GetUserBalance"),
    );
    expect(routes).toHaveLength(2);
    expect(routes.every((r) => r.coverage === "explicit" && r.issues.length === 0)).toBe(true);
    expect(routes.map((r) => r.resourceKind).sort()).toEqual(["batch", "single-resource"]);
    expect(
      source
        .getClassOrThrow("BalanceController")
        .getMethodOrThrow("getBatchBalances")
        .getDecorator("Middlewares")
        ?.getText(),
    ).toContain("replayProtectionMiddleware");
  });
});
