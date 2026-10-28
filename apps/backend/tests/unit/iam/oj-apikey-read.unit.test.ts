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
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const target = { id: "key", userId: "actor", status: 1, createTime: new Date(0), updateTime: new Date(0) };
const view = {
  ...target,
  name: "fixture",
  key: "fixture-only-credential",
  channel: { name: "fixture" },
  channelId: "channel",
  expiresAt: null,
  lastUsedAt: null,
  requestCount: 7,
  totalTokens: 11,
};
let iam: any, repository: any, request: TypedRequest, service: OjApiKeyIamService;
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    query: { accountId: "foreign" },
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow)),
  };
  repository = {
    assertActor: vi.fn(),
    target: vi.fn().mockResolvedValue(target),
    scan: vi.fn().mockResolvedValue([target]),
    hydrate: vi.fn().mockResolvedValue([view]),
  };
  service = new (OjApiKeyIamService as unknown as new (...args: any[]) => OjApiKeyIamService)(iam, repository);
});
describe("OJ key metadata and credential authorization", () => {
  it("registers native reads and an independent sensitive reveal Action", () => {
    expect(getIamActionDefinition("quyan:oj:RevealApiKey")).toMatchObject({
      sensitive: true,
      resourceTypes: ["oj/api-key"],
    });
    expect(getIamActionDefinition("quyan:oj:RevealApiKey")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.OJ_APIKEY_READ)).toContain("quyan:oj:RevealApiKey");
  });
  it("keeps legacy grants on the current user's key resources", () => {
    const policy = legacyPermissionsToPrincipalPolicy([Permission.OJ_APIKEY_READ], "owner", "actor")!;
    expect(
      evaluatePolicies([{ policyId: "legacy", document: policy }], {
        action: "quyan:oj:RevealApiKey",
        resource: "acs:oj:*:owner:api-key/actor/key",
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "legacy", document: policy }], {
        action: "quyan:oj:RevealApiKey",
        resource: "acs:oj:*:owner:api-key/peer/key",
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("authorizes metadata before reading credentials and rechecks before response", async () => {
    const rows = await service.list("actor", request);
    expect(rows).toHaveLength(1);
    expect(repository.hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ accountOwnerId: "owner" }),
      [target],
      ["key"],
    );
    expect(iam.authorizeMany.mock.calls.map(([r]: [{ action: string }]) => r.action)).toEqual([
      "quyan:oj:ListApiKeys",
      "quyan:oj:RevealApiKey",
      "quyan:oj:ListApiKeys",
      "quyan:oj:RevealApiKey",
    ]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ resources: ["acs:oj:*:owner:api-key/actor/key"] }),
    );
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])(
    "%s for reveal retains metadata but strips credential even from a faulty hydration",
    async (decision) => {
      iam.authorizeMany.mockImplementation(async ({ action, resources }: { action: string; resources: string[] }) =>
        resources.map(() => ({ ...allow, decision: action.endsWith(":RevealApiKey") ? decision : "Allow" })),
      );
      expect((await service.get("actor", "key", request)).key).toBeUndefined();
      expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), [target], []);
    },
  );
  it("metadata denial prevents any key hydration and details fail closed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map(() => ({ ...allow, decision: "ExplicitDeny" })),
    );
    await expect(service.get("actor", "key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), [], []);
  });
  it("revoked reveal permission strips an already-read credential", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    expect((await service.get("actor", "key", request)).key).toBeUndefined();
  });
  it("revoked metadata permission removes the entire row", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([{ ...allow, decision: "ImplicitDeny" }]);
    expect(await service.list("actor", request)).toEqual([]);
  });
  it("stats sum only allowed rows and never ask to reveal", async () => {
    const hidden = { ...target, id: "hidden", createTime: new Date(-1) },
      hiddenView = { ...view, id: "hidden", requestCount: 999 };
    repository.scan.mockResolvedValue([target, hidden]);
    repository.hydrate.mockImplementation(async (_: unknown, targets: (typeof target)[]) =>
      targets.map((t) => (t.id === "key" ? view : hiddenView)),
    );
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map((r) => ({ ...allow, decision: r.endsWith("/hidden") ? "ExplicitDeny" : "Allow" })),
    );
    expect(await service.stats("actor", request)).toEqual({
      totalKeys: 1,
      activeKeys: 1,
      totalRequests: 7,
      totalTokens: 11,
    });
    expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), [target], []);
    expect(
      iam.authorizeMany.mock.calls.every(([r]: [{ action: string }]) => r.action === "quyan:oj:GetApiKeyStats"),
    ).toBe(true);
  });
  it("rejects sparse decision output and mismatched hydrated owners", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow));
    repository.hydrate.mockResolvedValue([{ ...view, userId: "peer" }]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { targets: [{ ...target, userId: "peer" }] },
    { targets: [{ ...target, status: -1 }] },
    { targets: [{ ...target, id: "bad/id" }] },
    { targets: [target, target] },
  ])("rejects invalid scan metadata", async ({ targets }) => {
    repository.scan.mockResolvedValue(targets);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("denies missing or misbound identities and authorization outages", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture outage"));
    await expect(service.stats("actor", request)).rejects.toThrow("fixture outage");
    expect(repository.scan).not.toHaveBeenCalled();
  });
});
