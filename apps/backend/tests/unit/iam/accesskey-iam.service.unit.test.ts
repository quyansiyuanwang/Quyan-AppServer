import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { AccessKeyIamService } from "@/services/users/accesskey-iam.service";
import { accessKeyResourceResolver } from "@/iam/request/accesskey-resource-resolvers";
import { accessKeyArn } from "@/iam/resources/accesskey-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
let request: TypedRequest, iam: any, repository: any, service: AccessKeyIamService;
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { id: "forged-path" },
    query: { userId: "peer", accountOwnerId: "foreign" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
    secure: true,
    ip: "127.0.0.1",
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) =>
        resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
      ),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  repository = {
    assertPrincipal: vi.fn().mockResolvedValue(undefined),
    candidates: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue([]),
    hydrate: vi
      .fn()
      .mockImplementation(async (_principal: unknown, rows: { id: string }[]) =>
        rows.map((row) => ({ id: row.id, key: "masked" })),
      ),
    target: vi.fn().mockResolvedValue({ id: "actual-key", userId: "actor", status: 1, updateTime: new Date(0) }),
    revoke: vi.fn().mockResolvedValue({ id: "actual-key" }),
  };
  const Constructor = AccessKeyIamService as unknown as new (...args: any[]) => AccessKeyIamService;
  service = new Constructor(iam, repository);
});
describe("concrete access-key revocation", () => {
  it("registers a sensitive native Action with an explicit migration alias and no self grant", () => {
    expect(getIamActionDefinition("quyan:ram:DeleteAccessKey")).toMatchObject({
      sensitive: true,
      resourceTypes: ["quyan/access-key"],
      legacyPermission: Permission.ACCESSKEY_DELETE,
    });
    expect(getIamActionDefinition("quyan:ram:DeleteAccessKey")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.ACCESSKEY_DELETE)).toContain("quyan:ram:DeleteAccessKey");
  });
  it("evaluates actual method arguments and trusted account context rather than forged request metadata", async () => {
    await service.revoke("actor", "actual-key", request);
    expect(repository.target).toHaveBeenCalledWith(principal, "actual-key");
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:ram:DeleteAccessKey",
        resource: "acs:quyan:*:owner:access-key/actor/actual-key",
        principal,
      }),
    );
    expect(repository.revoke).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ id: "actual-key", userId: "actor" }),
    );
    expect(auditIamDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:ram:DeleteAccessKey", authorizationMode: "enforce" }),
    );
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("blocks %s without mutation", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "denied", matchedStatements: [] });
    await expect(service.revoke("actor", "actual-key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("fails closed when current authorization data is unavailable", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture backend unavailable"));
    await expect(service.revoke("actor", "actual-key", request)).rejects.toThrow("fixture backend unavailable");
    expect(repository.target).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("rejects missing identity, changed service user and third-party OAuth context before reading a key", async () => {
    await expect(service.revoke("actor", "actual-key")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.revoke("peer", "actual-key", request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as never;
    await expect(service.revoke("actor", "actual-key", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each([" actual-key", "actual-key ", "../key", "key/child", "key:*", "", "x".repeat(129)])(
    "rejects noncanonical identifier %s",
    async (id) => {
      await expect(service.revoke("actor", id, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.target).not.toHaveBeenCalled();
    },
  );
  it("does not accept a repository target that differs from the authorized key or user", async () => {
    for (const target of [
      { id: "different", userId: "actor" },
      { id: "actual-key", userId: "peer" },
    ]) {
      repository.target.mockResolvedValue(target);
      await expect(service.revoke("actor", "actual-key", request)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(iam.authorize).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
  });
  it("resolves route targets using the authenticated account and rejects wildcard identifiers", async () => {
    request.params.id = "actual-key";
    expect(await accessKeyResourceResolver({ request, principal })).toBe(accessKeyArn("owner", "actor", "actual-key"));
    request.params.id = "*";
    expect(await accessKeyResourceResolver({ request, principal })).toBeUndefined();
  });
});

const row = (id: string) => ({ id, userId: "actor", status: 1, updateTime: new Date(0), createTime: new Date(0) });
describe("bounded, masked access-key listings", () => {
  it("registers a real resource-scoped list Action with a migration alias but no self grant", () => {
    expect(getIamActionDefinition("quyan:ram:ListAccessKeys")).toMatchObject({
      sensitive: true,
      accessLevel: "List",
      resourceTypes: ["quyan/access-key"],
      legacyPermission: Permission.ACCESSKEY_READ,
    });
    expect(getIamActionDefinition("quyan:ram:ListAccessKeys")?.defaultAuthorizationScope).toBeUndefined();
  });
  it("filters each actual key using a fixed Action and reauthorizes only selected metadata before hydration", async () => {
    repository.candidates.mockResolvedValue([row("allowed"), row("denied"), row("next")]);
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map((resource) => ({
        decision: resource.endsWith("/allowed") ? "Allow" : "ExplicitDeny",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    const page = await service.listPage("actor", { page: 3, pageSize: 2 }, request);
    expect(page).toEqual({ page: 3, pageSize: 2, items: [{ id: "allowed", key: "masked" }], hasNext: true });
    expect(page).not.toHaveProperty("total");
    expect(iam.authorizeMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "quyan:ram:ListAccessKeys",
        resources: ["acs:quyan:*:owner:access-key/actor/allowed", "acs:quyan:*:owner:access-key/actor/denied"],
      }),
    );
    expect(repository.hydrate).toHaveBeenCalledWith(principal, [row("allowed")]);
    expect(iam.loadPolicies).toHaveBeenCalledTimes(2);
  });
  it("allows navigation from an empty filtered page without a blanket collection grant", async () => {
    repository.candidates.mockResolvedValue([row("denied"), row("next")]);
    iam.authorizeMany.mockResolvedValue([{ decision: "ImplicitDeny" }]);
    expect(await service.listPage("actor", { page: 1, pageSize: 1 }, request)).toMatchObject({
      items: [],
      hasNext: true,
    });
  });
  it("fails closed when permission changes between selection and hydration", async () => {
    repository.candidates.mockResolvedValue([row("allowed")]);
    iam.authorizeMany
      .mockResolvedValueOnce([{ decision: "Allow" }])
      .mockResolvedValueOnce([{ decision: "ExplicitDeny" }]);
    await expect(service.listPage("actor", { page: 1, pageSize: 1 }, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each([[], [undefined], new Array(1), null])("rejects incomplete batch decisions %#", async (decisions) => {
    repository.candidates.mockResolvedValue([row("key")]);
    iam.authorizeMany.mockResolvedValue(decisions);
    await expect(service.listPage("actor", { page: 1, pageSize: 1 }, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects foreign metadata and invalid identity before returning even an empty list", async () => {
    repository.candidates.mockResolvedValue([{ ...row("peer-key"), userId: "peer" }]);
    await expect(service.listPage("actor", { page: 1, pageSize: 1 }, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as never;
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("retains all compatibility results across bounded scan and hydration batches", async () => {
    const rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest }, (_, i) => row("key-" + i));
    repository.scan.mockResolvedValueOnce(rows).mockResolvedValueOnce([row("last")]);
    const result = await service.list("actor", request);
    expect(result).toHaveLength(rows.length + 1);
    expect(repository.scan).toHaveBeenNthCalledWith(2, principal, rows[rows.length - 1]);
    expect(repository.hydrate.mock.calls.map((call: [unknown, { id: string }[]]) => call[1].length)).toEqual([
      rows.length,
      1,
    ]);
    expect(repository.assertPrincipal).toHaveBeenCalledTimes(2);
  });
  it("propagates final identity/snapshot and authorization data failures rather than falling open", async () => {
    repository.candidates.mockResolvedValue([row("key")]);
    repository.hydrate.mockRejectedValue(new Error("fixture conflict"));
    await expect(service.listPage("actor", { page: 1, pageSize: 1 }, request)).rejects.toThrow("fixture conflict");
    iam.loadPolicies.mockRejectedValue(new Error("fixture policy backend"));
    await expect(service.list("actor", request)).rejects.toThrow("fixture policy backend");
  });
});
