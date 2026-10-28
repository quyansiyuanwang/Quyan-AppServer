import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRelayProbeAccountRefreshIamService } from "@/services/relay/platform-relay-probe-account-refresh-iam.service";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { inspect: vi.fn(), recordAttempt: vi.fn(), publish: vi.fn() },
  identities = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn(),
  refresh = vi.fn(),
  locks = { withWrite: vi.fn() },
  service = new PlatformRelayProbeAccountRefreshIamService(iam, repository, identities, permissions, locks);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    params: { accountId: "target" },
    secure: true,
  }) as unknown as TypedRequest;
const execute = () => service.execute("target", request(), legacy, refresh);
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
  repository.inspect.mockImplementation(async (_id, context) => context.recheck());
  repository.recordAttempt.mockImplementation(async (_id, context) => context.recheck());
  repository.publish.mockImplementation(async (_id, context, commit) => {
    await context.recheck();
    await commit();
  });
  legacy.mockResolvedValue("legacy");
  refresh.mockImplementation(async (guard) => {
    await guard.recordAttempt();
    await guard.publish(async () => {});
    return "native";
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("probe-account refresh lifecycle authorization", () => {
  it("declares a dedicated resource action with a platform qualification ceiling", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/accounts/{accountId}/refresh",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:RefreshProbeAccount"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:RefreshProbeAccount")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-probe-account"],
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
    });
  });
  it("holds the shared account lock around authorized attempt and publication guards", async () => {
    expect(await execute()).toBe("native");
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:RefreshProbeAccount",
        resources: [platformRelayProbeAccountArn("target")],
      }),
    );
    expect(locks.withWrite).toHaveBeenCalledWith("probe-account:target", expect.any(Function), expect.any(Number));
    expect(repository.recordAttempt).toHaveBeenCalledOnce();
    expect(repository.publish).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])(
    "blocks %s before taking the lock or reading credentials",
    async (decision) => {
      iam.authorizeMany.mockResolvedValue([{ decision, reason: "fixture", matchedStatements: [] }]);
      await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
      expect(locks.withWrite).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
  it("rechecks authorization after waiting for an active probe", async () => {
    locks.withWrite.mockImplementation(async (_key, work) => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "revoked", matchedStatements: [] }]);
      return work();
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(refresh).not.toHaveBeenCalled();
  });
  it("fails closed if authoritative platform qualification or policies are unavailable", async () => {
    identities.snapshot.mockRejectedValue(new Error("fixture unavailable"));
    await expect(execute()).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each([undefined, "delegated", "oauth"])("rejects invalid identity context %s", async (kind) => {
    const req = kind === undefined ? undefined : request();
    if (kind === "delegated") req!.authContext!.principalUserId = "issuer";
    if (kind === "oauth") req!.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(service.execute("target", req, legacy, refresh)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never logs in or publishes a session during shadow preview", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await execute()).toBe("legacy");
    expect(repository.inspect).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(repository.recordAttempt).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
    expect(locks.withWrite).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy permission enforcement in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("retains legacy refresh when shadow authorization is denied", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorizeMany.mockRejectedValue(new Error("fixture denied"));
    expect(await execute()).toBe("legacy");
    expect(refresh).not.toHaveBeenCalled();
  });
});
