import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRelayProbeAccountUpdateIamService } from "@/services/relay/platform-relay-probe-account-update-iam.service";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { platformRelayProbeAccountResourceResolver } from "@/iam/request/relay-probe-resource-resolvers";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { update: vi.fn() },
  identities = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  locks = { withWrite: vi.fn() },
  encrypt = vi.fn(),
  legacy = vi.fn(),
  invalidate = vi.fn(),
  service = new PlatformRelayProbeAccountUpdateIamService(iam, repository, identities, permissions, locks);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    params: { accountId: "target" },
    secure: true,
  }) as unknown as TypedRequest;
const input = {
  name: "fixture-updated",
  loginWorkflow: { method: "POST" as const, url: "https://example.com/login" },
  tokenPath: "data.token",
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  credentials: { username: "fixture", password: "fixture-secret" },
};
const row = {
  id: "target",
  name: "fixture-updated",
  tokenPath: "data.token",
  expiresPath: null,
  expiresMode: null,
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  lastLoginAttemptAt: null,
  updateTime: new Date(0),
  hasCredentials: true,
};
const remove = () => service.update("target", input, encrypt, request(), legacy, invalidate);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  identities.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  locks.withWrite.mockImplementation(async (_key, work) => work());
  legacy.mockResolvedValue({ ...row, cached: false });
  repository.update.mockImplementation(async (_id, _input, _principal, _snapshot, recheck, _encrypt, persist) => {
    await recheck();
    return persist ? row : undefined;
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("resource-scoped probe account updates", () => {
  it("registers a fixed platform action and route", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PUT /v1/relay-channel-probes/accounts/{accountId}",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:UpdateProbeAccount"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:UpdateProbeAccount")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-probe-account"],
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
    });
  });
  it("resolves only a trusted server parameter and ignores spoofed action input", async () => {
    const req = request();
    expect(
      await platformRelayProbeAccountResourceResolver({
        request: req,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe(platformRelayProbeAccountArn("target"));
    req.params.accountId = "../other";
    expect(
      await platformRelayProbeAccountResourceResolver({
        request: req,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBeUndefined();
    await remove();
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:UpdateProbeAccount",
        resources: [platformRelayProbeAccountArn("target")],
      }),
    );
  });
  it("invalidates the session only after the authorized repository commits", async () => {
    await remove();
    expect(repository.update.mock.calls[0]?.[6]).toBe(true);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(repository.update.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0]!);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("blocks %s before touching the account or cache", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ decision, reason: "fixture", matchedStatements: [] }]);
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it.each([undefined, "delegated", "oauth"])("rejects unavailable principal context %s", async (kind) => {
    const req = kind === undefined ? undefined : request();
    if (kind === "delegated") req!.authContext!.principalUserId = "issuer";
    if (kind === "oauth") req!.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(service.update("target", input, encrypt, req, legacy, invalidate)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects absent platform eligibility before evaluating account grants", async () => {
    identities.snapshot.mockRejectedValue(new Error("fixture revoked"));
    await expect(remove()).rejects.toThrow();
    expect(iam.authorizeMany).not.toHaveBeenCalled();
  });
  it("rejects stale policies at the repository boundary", async () => {
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          policyId: "new",
          document: {
            Version: "1",
            Statement: { Effect: "Deny", Action: "quyan:relay:UpdateProbeAccount", Resource: "*" },
          },
        },
      ]);
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("does not invalidate the cached session when persistence fails", async () => {
    repository.update.mockRejectedValue(new Error("fixture conflict"));
    await expect(remove()).rejects.toThrow();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy permission enforcement in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await remove();
    expect(legacy).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    if (mode === "shadow") expect(repository.update.mock.calls[0]?.[6]).toBe(false);
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains the legacy outcome when shadow evaluation denies", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorizeMany.mockRejectedValue(new Error("fixture unavailable"));
    await remove();
    expect(legacy).toHaveBeenCalledOnce();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("returns only public configuration after commit", async () => {
    const result = await remove();
    expect(result).toMatchObject({ id: "target", name: input.name, cached: false, hasCredentials: true });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it.each([
    { ...input, tokenPath: "" },
    { ...input, minLoginIntervalSeconds: 0 },
    { ...input, credentials: { accountToken: "forbidden" } },
  ])("rejects invalid or reserved configuration before reading secrets", async (invalid) => {
    await expect(service.update("target", invalid, encrypt, request(), legacy, invalidate)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repository.update).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
  });
  it("rechecks a queued mutation after acquiring the probe coordination lock", async () => {
    locks.withWrite.mockImplementation(async (_key, work) => {
      iam.authorizeMany.mockResolvedValue([
        { decision: "ExplicitDeny", reason: "fixture-revoked", matchedStatements: [] },
      ]);
      return work();
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(locks.withWrite).toHaveBeenCalledWith("probe-account:target", expect.any(Function));
    expect(repository.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
