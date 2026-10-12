import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { IamAccountUserAuthorizationService } from "@/services/users/iam-account-user-authorization.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let iam: any, repository: any, service: IamAccountUserAuthorizationService, request: TypedRequest, read: any;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue(allow),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow)),
  };
  repository = {
    target: vi.fn().mockResolvedValue({ id: "peer", updateTime: new Date(0) }),
    targets: vi
      .fn()
      .mockImplementation(async (_: unknown, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  };
  read = vi.fn().mockResolvedValue({ messages: [] });
  service = new (IamAccountUserAuthorizationService as unknown as new (
    ...args: any[]
  ) => IamAccountUserAuthorizationService)(iam, repository);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { userId: "foreign" },
    query: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("trusted account user read boundary", () => {
  it("registers a dedicated sensitive conversation read Action without self grants", () => {
    expect(getIamActionDefinition("quyan:support:GetUserConversation")).toMatchObject({
      sensitive: true,
      resourceTypes: ["quyan/user"],
    });
    expect(getIamActionDefinition("quyan:support:GetUserConversation")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.SUPPORT_AI_ANALYTICS_READ)).toContain(
      "quyan:support:GetUserConversation",
    );
  });
  it("authorizes the actual stored target twice and invokes only the trusted user callback", async () => {
    await service.read("quyan:support:GetUserConversation", "peer", request, read);
    expect(read).toHaveBeenCalledWith("peer");
    expect(iam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:support:GetUserConversation", resource: "acs:quyan:*:owner:user/peer" }),
    );
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("%s prevents private data access", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.read("quyan:support:GetUserConversation", "peer", request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("blocks revoked grants and modified user revisions before response", async () => {
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.read("quyan:support:GetUserConversation", "peer", request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.authorize.mockResolvedValue(allow);
    repository.target
      .mockResolvedValueOnce({ id: "peer", updateTime: new Date(0) })
      .mockResolvedValueOnce({ id: "peer", updateTime: new Date(1) });
    await expect(service.read("quyan:support:GetUserConversation", "peer", request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each([null, { id: "foreign", updateTime: new Date(0) }])(
    "rejects missing or misbound targets before reading private content",
    async (target) => {
      repository.target.mockResolvedValue(target);
      await expect(service.read("quyan:support:GetUserConversation", "peer", request, read)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("refuses unknown Actions, unrelated resources, mutation Actions and missing identity", async () => {
    for (const action of ["*", "alidns:DescribeDomains", "quyan:oj:GetApiKey", "quyan:ram:CreateUser"])
      await expect(service.read(action, "peer", request, read)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read("quyan:support:GetUserConversation", "peer", undefined, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("never reads private data when authorization storage is unavailable", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture outage"));
    await expect(service.read("quyan:support:GetUserConversation", "peer", request, read)).rejects.toThrow(
      "fixture outage",
    );
    expect(read).not.toHaveBeenCalled();
  });
});

describe("batched account user read boundary", () => {
  const action = "quyan:balance:GetUserBalance";
  it("evaluates every selected user twice and collapses duplicate targets", async () => {
    await service.readMany(action, ["peer", "actor", "peer"], request, read);
    expect(read).toHaveBeenCalledWith(["peer", "actor"]);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action, resources: ["acs:quyan:*:owner:user/peer", "acs:quyan:*:owner:user/actor"] }),
    );
  });
  it("denies the whole batch when one resource is denied, regardless of an earlier Allow", async () => {
    iam.authorizeMany.mockResolvedValue([allow, { ...allow, decision: "ExplicitDeny" }]);
    await expect(service.readMany(action, ["peer", "actor"], request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("withholds the response when a batch grant is revoked during hydration", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([allow, allow])
      .mockResolvedValueOnce([allow, { ...allow, decision: "ImplicitDeny" }]);
    await expect(service.readMany(action, ["peer", "actor"], request, read)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses targets that are missing, duplicated or outside the requested set", async () => {
    for (const targets of [
      [{ id: "peer", updateTime: new Date(0) }],
      [
        { id: "peer", updateTime: new Date(0) },
        { id: "peer", updateTime: new Date(0) },
      ],
      [
        { id: "peer", updateTime: new Date(0) },
        { id: "foreign", updateTime: new Date(0) },
      ],
    ]) {
      repository.targets.mockResolvedValue(targets);
      await expect(service.readMany(action, ["peer", "actor"], request, read)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("guards every user revision before returning batch data", async () => {
    repository.targets
      .mockResolvedValueOnce([{ id: "peer", updateTime: new Date(0) }])
      .mockResolvedValueOnce([{ id: "peer", updateTime: new Date(1) }]);
    await expect(service.readMany(action, ["peer"], request, read)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not trust sparse results or unsafe batch identifiers", async () => {
    for (const ids of [[], ["*"], ["bad/id"], Array(1), Array.from({ length: 501 }, (_, i) => "id" + i)])
      await expect(service.readMany(action, ids, request, read)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue(Array(1));
    await expect(service.readMany(action, ["peer"], request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
});
