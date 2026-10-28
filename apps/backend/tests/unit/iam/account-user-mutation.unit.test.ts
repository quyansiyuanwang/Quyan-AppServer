import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { IamAccountUserMutationService } from "@/services/users/iam-account-user-mutation.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const action = "quyan:balance:RechargeUserBalance",
  allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: IamAccountUserMutationService, iam: any, repository: any, request: TypedRequest;
beforeEach(() => {
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  repository = {
    targets: vi
      .fn()
      .mockImplementation(async (_: unknown, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  };
  service = new (IamAccountUserMutationService as unknown as new (...args: any[]) => IamAccountUserMutationService)(
    iam,
    repository,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { userId: "peer", accountOwnerId: "foreign" },
  } as unknown as TypedRequest;
});
describe("account user write boundary", () => {
  it("registers a sensitive Write Action without automatic self-service permission", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["quyan/user"],
      sensitive: true,
    });
    expect(getIamActionDefinition(action)?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.BALANCE_RECHARGE)).toContain(action);
  });
  it("uses server Action and trusted account while preserving independent actor, owner and target revisions", async () => {
    const guard = await service.prepare(action, "peer", request);
    expect(guard.users.map((row) => row.id).sort()).toEqual(["actor", "owner", "peer"]);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action, resource: "acs:quyan:*:owner:user/peer" }),
    );
    expect(guard.principal.accountOwnerId).toBe("owner");
  });
  it("reloads authorization for each commit check and fails when an Allow is revoked", async () => {
    const guard = await service.prepare(action, "peer", request);
    await guard.recheck();
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] });
    await expect(guard.recheck()).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorize).toHaveBeenCalledTimes(3);
  });
  it.each(["quyan:balance:GetUserBalance", "unknown:Write", "quyan:oj:DeleteApiKey"])(
    "rejects unsuitable Action %s",
    async (candidate) => {
      await expect(service.prepare(candidate, "peer", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.targets).not.toHaveBeenCalled();
    },
  );
  it("fails closed for a missing target or account identity", async () => {
    repository.targets.mockResolvedValue([
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ]);
    await expect(service.prepare(action, "foreign", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorize).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "peer/other", "*"])("rejects missing context or malformed target %s", async (id) => {
    await expect(service.prepare(action, id as string, id === undefined ? undefined : request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("copies snapshot revisions so repository result mutations cannot alter the expected version", async () => {
    const date = new Date(0),
      rows = ["actor", "owner", "peer"].map((id) => ({ id, updateTime: date }));
    repository.targets.mockResolvedValue(rows);
    const guard = await service.prepare(action, "peer", request);
    date.setTime(1000);
    expect(guard.users.every((row) => row.updateTime.getTime() === 0)).toBe(true);
  });
});
