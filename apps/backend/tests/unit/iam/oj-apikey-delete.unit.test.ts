import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/oj-submitter/oj-apikey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    OjApiKeyManagementRepository: { getInstance: vi.fn() },
    ojApiKeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { OjApiKeyIamService } from "@/services/oj-submitter/oj-apikey-iam.service";
import { ojApiKeyResourceResolver } from "@/iam/request/oj-apikey-resource-resolvers";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const target = { id: "key", userId: "actor", status: 1, updateTime: new Date(0) };
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let iam: any, repository: any, request: TypedRequest, service: OjApiKeyIamService;
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "forged-key" },
    query: { accountId: "foreign" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  repository = { target: vi.fn().mockResolvedValue(target), revoke: vi.fn().mockResolvedValue({ id: "key" }) };
  service = new (OjApiKeyIamService as unknown as new (...args: any[]) => OjApiKeyIamService)(iam, repository);
});
describe("OJ API Key resource revocation", () => {
  it("registers an exact-resource sensitive Action without an automatic self grant", () => {
    expect(getIamActionDefinition("quyan:oj:DeleteApiKey")).toMatchObject({
      sensitive: true,
      resourceTypes: ["oj/api-key"],
      legacyPermission: Permission.OJ_APIKEY_DELETE,
    });
    expect(getIamActionDefinition("quyan:oj:DeleteApiKey")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.OJ_APIKEY_DELETE)).toContain("quyan:oj:DeleteApiKey");
  });
  it("checks actual service arguments twice and commits exactly the original snapshot", async () => {
    await service.revoke("actor", "key", request);
    expect(repository.target).toHaveBeenCalledWith(principal, "key");
    expect(iam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:oj:DeleteApiKey", resource: "acs:oj:*:owner:api-key/actor/key" }),
    );
    expect(repository.revoke).toHaveBeenCalledWith(principal, target);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s before mutation", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.revoke("actor", "key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("blocks revocation during the request", async () => {
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.revoke("actor", "key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("shadow-only evaluation never mutates", async () => {
    await service.authorizeDeletion("actor", "key", request);
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it.each([null, { ...target, id: "different" }, { ...target, userId: "peer" }, { ...target, status: -1 }])(
    "refuses misbound metadata",
    async (row) => {
      repository.target.mockResolvedValue(row);
      await expect(service.revoke("actor", "key", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.revoke).not.toHaveBeenCalled();
    },
  );
  it("rejects missing identity and outages before resource lookup", async () => {
    await expect(service.revoke("actor", "key")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.revoke("peer", "key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.revoke("actor", "key", request)).rejects.toThrow("fixture unavailable");
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each(["*", "bad/id", " key", "key ", "x".repeat(129)])("rejects malformed actual resource %s", async (id) => {
    await expect(service.revoke("actor", id, request)).rejects.toMatchObject({ statusCode: 403 });
    request.params.id = id;
    expect(await ojApiKeyResourceResolver({ request, principal: principal as never })).toBeUndefined();
  });
});
