import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
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
import { IamAccountUserCollectionService } from "@/services/users/iam-account-user-collection.service";
import { supportAnalyticsQuerySchema } from "@/api/schema/support/support-analytics.schema";
import type { TypedRequest } from "@/types/express";
const action = "quyan:support:GetUserUsageAnalytics",
  allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
let service: IamAccountUserCollectionService, iam: any, repository: any, users: any, request: TypedRequest, reader: any;
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow)),
  };
  repository = {
    assertActor: vi.fn(),
    scanTargets: vi.fn().mockResolvedValue(["actor", "owner", "peer"].map((id) => ({ id, updateTime: new Date(0) }))),
  };
  users = {
    authorizeMany: vi.fn().mockImplementation(async (_: string, ids: string[]) => ({
      principal,
      targets: ids.map((id) => ({ id, updateTime: new Date(0) })),
    })),
    authorize: vi.fn().mockResolvedValue({ principal, target: { id: "peer", updateTime: new Date(0) } }),
  };
  reader = vi.fn().mockResolvedValue({ total: 15 });
  service = new (IamAccountUserCollectionService as unknown as new (...args: any[]) => IamAccountUserCollectionService)(
    iam,
    repository,
    users,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("account user aggregate boundary", () => {
  it("passes only authorized user IDs and the trusted account to the aggregate reader", async () => {
    iam.authorizeMany.mockResolvedValue([deny, deny, allow]);
    expect(await service.read(action, request, reader)).toEqual({ total: 15 });
    expect(reader).toHaveBeenCalledWith(["peer"], expect.objectContaining({ accountOwnerId: "owner" }));
    expect(users.authorizeMany).toHaveBeenCalledWith(action, ["peer"], request);
  });
  it("an empty grant set still validates the account and calls the reader with an empty scope", async () => {
    iam.authorizeMany.mockResolvedValue([deny, deny, deny]);
    await service.read(action, request, reader);
    expect(reader).toHaveBeenCalledWith([], expect.objectContaining({ accountOwnerId: "owner" }));
    expect(repository.assertActor).toHaveBeenCalledTimes(2);
  });
  it("does not return aggregate values after authorization is revoked", async () => {
    users.authorizeMany.mockRejectedValue(new Error("fixture revoked"));
    await expect(service.read(action, request, reader)).rejects.toThrow("fixture revoked");
  });
  it.each([{ targets: [] }, { targets: [{ id: "peer", updateTime: new Date(1000) }] }, { targets: new Array(3) }])(
    "rejects incomplete, stale or sparse final user versions",
    async ({ targets }) => {
      users.authorizeMany.mockResolvedValue({ principal, targets });
      await expect(service.read(action, request, reader)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("requires specific-user authorization instead of silently returning another user", async () => {
    await service.read(action, request, reader, "peer");
    expect(users.authorize).toHaveBeenCalledWith(action, "peer", request);
    expect(reader).toHaveBeenCalledWith(["peer"], expect.anything());
    expect(repository.scanTargets).not.toHaveBeenCalled();
  });
  it("diagnoses candidate resources without reading aggregate data", async () => {
    await service.authorizeCollection(action, request);
    expect(reader).not.toHaveBeenCalled();
  });
  it("fails closed for missing decisions before aggregate queries", async () => {
    iam.authorizeMany.mockResolvedValue(new Array(3));
    await expect(service.read(action, request, reader)).rejects.toMatchObject({ statusCode: 403 });
    expect(reader).not.toHaveBeenCalled();
  });
  it.each(["quyan:balance:RechargeUserBalance", "quyan:oj:ListApiKeys", "unknown:Read"])(
    "rejects unsuitable Action %s",
    async (candidate) => {
      await expect(service.read(candidate, request, reader)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.scanTargets).not.toHaveBeenCalled();
    },
  );
  it("rejects a duplicate or unordered account scan page", async () => {
    repository.scanTargets.mockResolvedValue([
      { id: "peer", updateTime: new Date(0) },
      { id: "actor", updateTime: new Date(0) },
    ]);
    await expect(service.read(action, request, reader)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("streams more than 500 user resources and rechecks grants in bounded batches", async () => {
    const page = Array.from({ length: 501 }, (_, i) => ({
      id: "user" + String(i).padStart(4, "0"),
      updateTime: new Date(0),
    }));
    repository.scanTargets.mockResolvedValueOnce(page.slice(0, 500)).mockResolvedValueOnce(page.slice(500));
    await service.read(action, request, reader);
    expect(reader.mock.calls[0][0]).toHaveLength(501);
    expect(users.authorizeMany).toHaveBeenCalledTimes(2);
    expect(repository.scanTargets.mock.calls[1][1]).toBe("user0499");
  });
});
describe("support analytics query validation", () => {
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { userId: "*" },
    { startAt: "invalid" },
    { startAt: "2026-10-12", endAt: "2026-10-11" },
    { startAt: "2999-01-01" },
  ])("rejects malformed query %j", (query) => {
    expect(supportAnalyticsQuerySchema.safeParse(query).success).toBe(false);
  });
  it("accepts validated IDs, integer strings and bounded date strings", () => {
    expect(
      supportAnalyticsQuerySchema.parse({ page: "2", pageSize: "20", userId: "peer", startAt: "2026-10-11" }),
    ).toMatchObject({ page: 2, pageSize: 20, userId: "peer" });
  });
});
