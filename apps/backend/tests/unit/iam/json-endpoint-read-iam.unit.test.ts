import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/json-endpoint-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    JsonEndpointManagementRepository: { getInstance: vi.fn() },
    jsonEndpointDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { JsonEndpointIamService } from "@/services/json-endpoint/json-endpoint-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";
let iam: any, repository: any, service: JsonEndpointIamService, request: TypedRequest;
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const target = (id = "ep-z", userId = "actor") => ({ id, userId, createTime: new Date(0), updateTime: new Date(0) });
const view = (id = "ep-z", userId = "actor") => ({
  ...target(id, userId),
  ownerUsername: "fixture",
  name: "endpoint",
  slug: "fixture",
  isRootSlug: false,
  jsonContent: { private: true },
  isPublic: false,
  accessMode: "static-password",
  hasPassword: true,
  publicKey: null,
  publicKeyFingerprint: null,
  signatureAlgorithm: null,
  accessCount: 0,
  lastAccessAt: null,
});
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "forged" },
    headers: { "x-action": "*" },
    query: { ownerUserId: "foreign" },
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }) => resources.map(() => allow)),
  };
  repository = {
    assertActor: vi.fn(),
    assertOwner: vi.fn(),
    scan: vi.fn().mockResolvedValue([target()]),
    target: vi.fn().mockResolvedValue(target()),
    deleteTarget: vi.fn().mockResolvedValue({ id: "ep-z", userId: "actor", name: "fixture", slug: "fixture" }),
    hydrate: vi
      .fn()
      .mockImplementation(async (_p, rows) => rows.map((t: { id: string; userId: string }) => view(t.id, t.userId))),
    scanOwners: vi.fn().mockResolvedValue([{ ...target("peer", "peer") }]),
    hydrateOwners: vi.fn().mockResolvedValue([{ id: "peer", username: "fixture" }]),
  };
  service = new (JsonEndpointIamService as unknown as new (...args: any[]) => JsonEndpointIamService)(iam, repository);
});
describe("JSON Endpoint read IAM", () => {
  it("registers converging legacy aliases on one native server Action", () => {
    for (const permission of [Permission.JSON_ENDPOINT_READ, Permission.JSON_ENDPOINT_MANAGE])
      for (const action of ["quyan:json_endpoint:ListEndpoints", "quyan:json_endpoint:GetEndpoint"])
        expect(iamActionsForLegacyPermission(permission)).toContain(action);
    expect(getIamActionDefinition("quyan:json_endpoint:GetEndpoint")?.resourceTypes).toEqual([
      "json-endpoint/endpoint",
    ]);
    expect(getIamActionDefinition("quyan:json_endpoint:GetEndpoint")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.JSON_ENDPOINT_READ)).not.toContain(
      "quyan:json_endpoint:ListEndpointOwners",
    );
  });
  it("legacy Read stays on the actor's endpoints while Manage permits same-account peer endpoints", () => {
    const own = "acs:json-endpoint:*:owner:endpoint/actor/ep-z",
      peer = "acs:json-endpoint:*:owner:endpoint/peer/ep-z";
    const read = legacyPermissionsToPrincipalPolicy([Permission.JSON_ENDPOINT_READ], "owner", "actor")!;
    for (const action of ["quyan:json_endpoint:ListEndpoints", "quyan:json_endpoint:GetEndpoint"]) {
      expect(evaluatePolicies([{ policyId: "read", document: read }], { action, resource: own }).decision).toBe(
        "Allow",
      );
      expect(evaluatePolicies([{ policyId: "read", document: read }], { action, resource: peer }).decision).toBe(
        "ImplicitDeny",
      );
      const manage = legacyPermissionsToPrincipalPolicy([Permission.JSON_ENDPOINT_MANAGE], "owner", "actor")!;
      expect(evaluatePolicies([{ policyId: "manage", document: manage }], { action, resource: peer }).decision).toBe(
        "Allow",
      );
    }
    const deny = legacyPermissionsToPrincipalPolicy([Permission.JSON_ENDPOINT_READ], "owner", "actor", "Deny")!;
    expect(
      evaluatePolicies([{ policyId: "deny", document: deny }], {
        action: "quyan:json_endpoint:GetEndpoint",
        resource: peer,
      }).decision,
    ).toBe("ExplicitDeny");
  });
  it("checks actual persisted ownership before retrieving contents", async () => {
    repository.target.mockResolvedValue(target("ep-z", "peer"));
    repository.hydrate.mockResolvedValue([view("ep-z", "peer")]);
    expect(await service.get("actor", "ep-z", request)).toMatchObject({
      userId: "peer",
      hasPassword: true,
      jsonContent: { private: true },
      publicUrl: "/v1/json/fixture/fixture",
    });
    expect(repository.target).toHaveBeenCalledWith(principal, "ep-z");
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:json_endpoint:GetEndpoint",
        resources: ["acs:json-endpoint:*:owner:endpoint/peer/ep-z"],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("does not read denied %s payloads", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision }]);
    await expect(service.get("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("checks owner filters against the trusted account before scanning", async () => {
    await service.list("actor", "peer", request);
    expect(repository.assertOwner).toHaveBeenCalledWith(principal, "peer");
    expect(repository.scan).toHaveBeenCalledWith(principal, "peer", undefined);
    repository.assertOwner.mockRejectedValue(new Error("foreign owner"));
    repository.scan.mockClear();
    await expect(service.list("actor", "foreign", request)).rejects.toThrow("foreign owner");
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("filters lists before hydration and filters owner names independently", async () => {
    repository.scan.mockResolvedValue([target("ep-z"), target("ep-a")]);
    iam.authorizeMany.mockResolvedValueOnce([allow, { ...allow, decision: "ExplicitDeny" }]);
    expect((await service.list("actor", undefined, request)).map((r) => r.id)).toEqual(["ep-z"]);
    expect(repository.hydrate).toHaveBeenCalledWith(principal, [target("ep-z")]);
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision: "ImplicitDeny" }]);
    repository.hydrateOwners.mockResolvedValue([]);
    expect(await service.owners("actor", request)).toEqual([]);
    expect(repository.hydrateOwners).toHaveBeenCalledWith(principal, []);
  });
  it("rechecks permission after hydration", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    await expect(service.get("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    expect(await service.list("actor", undefined, request)).toEqual([]);
  });
  it("rejects misbound and missing targets", async () => {
    for (const row of [null, target("other"), target("ep-z", "bad/id")]) {
      repository.target.mockResolvedValue(row);
      await expect(service.get("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects hydrate results for another endpoint or owner", async () => {
    repository.hydrate.mockResolvedValue([view("ep-z", "peer")]);
    await expect(service.get("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("actor", undefined, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([{ results: [] }, { results: [undefined] }, { results: undefined }])(
    "fails closed on incomplete decision arrays",
    async ({ results }) => {
      iam.authorizeMany.mockResolvedValue(results);
      await expect(service.get("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects missing principal or a changed service subject before reading", async () => {
    await expect(service.get("actor", "ep-z")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get("peer", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.assertActor).not.toHaveBeenCalled();
  });
  it.each([" bad", "bad/id", "*", "x".repeat(129)])("rejects noncanonical actual identifiers", async (id) => {
    await expect(service.get("actor", id, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("actor", id, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("does not rescue unavailable authorization storage with a legacy fallback", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.list("actor", undefined, request)).rejects.toThrow("fixture unavailable");
    expect(repository.scan).not.toHaveBeenCalled();
  });
});

describe("JSON Endpoint resource deletion", () => {
  it("registers a sensitive exact-resource write with Read excluded", () => {
    const action = "quyan:json_endpoint:DeleteEndpoint";
    expect(getIamActionDefinition(action)).toMatchObject({
      sensitive: true,
      resourceTypes: ["json-endpoint/endpoint"],
    });
    expect(iamActionsForLegacyPermission(Permission.JSON_ENDPOINT_DELETE)).toContain(action);
    expect(iamActionsForLegacyPermission(Permission.JSON_ENDPOINT_MANAGE)).toContain(action);
    expect(iamActionsForLegacyPermission(Permission.JSON_ENDPOINT_READ)).not.toContain(action);
  });
  it("old Delete preserves own endpoints and never silently grants peer deletion", () => {
    const action = "quyan:json_endpoint:DeleteEndpoint",
      document = legacyPermissionsToPrincipalPolicy([Permission.JSON_ENDPOINT_DELETE], "owner", "actor")!;
    expect(
      evaluatePolicies([{ policyId: "legacy", document }], {
        action,
        resource: "acs:json-endpoint:*:owner:endpoint/actor/ep-z",
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "legacy", document }], {
        action,
        resource: "acs:json-endpoint:*:owner:endpoint/peer/ep-z",
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("authorizes actual metadata and commits only the original snapshot", async () => {
    await service.delete("actor", "ep-z", request);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:json_endpoint:DeleteEndpoint",
        resources: ["acs:json-endpoint:*:owner:endpoint/actor/ep-z"],
      }),
    );
    expect(repository.deleteTarget).toHaveBeenCalledWith(principal, target());
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s before mutation", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision }]);
    await expect(service.delete("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.deleteTarget).not.toHaveBeenCalled();
  });
  it("refuses a revocation between the two checks", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    await expect(service.delete("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.deleteTarget).not.toHaveBeenCalled();
  });
  it("shadow-only evaluation cannot write", async () => {
    await service.authorizeDeletion("actor", "ep-z", request);
    expect(repository.deleteTarget).not.toHaveBeenCalled();
  });
  it("refuses absent or misbound records and authorization outages", async () => {
    for (const row of [null, target("different"), target("ep-z", "bad/id")]) {
      repository.target.mockResolvedValue(row);
      await expect(service.delete("actor", "ep-z", request)).rejects.toMatchObject({ statusCode: 403 });
    }
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.delete("actor", "ep-z", request)).rejects.toThrow("fixture unavailable");
    expect(repository.deleteTarget).not.toHaveBeenCalled();
  });
});
