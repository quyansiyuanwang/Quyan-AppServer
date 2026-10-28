import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRelayProbeAccountReadIamService } from "@/services/relay/platform-relay-probe-account-read-iam.service";
import { projectRelayProbeAccount } from "@/services/relay/relay-probe-account-projection";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { list: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  map = vi.fn(),
  legacy = vi.fn(),
  service = new PlatformRelayProbeAccountReadIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.list.mockImplementation(async (_p, decide, recheck) => {
    await decide([platformRelayProbeAccountArn("account")]);
    await recheck();
    return ["fixture-native"];
  });
  legacy.mockResolvedValue(["fixture-legacy"]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("platform probe account reads", () => {
  it("declares a fixed resource-level collection action and the platform ceiling", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channel-probes/accounts",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ListProbeAccounts"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ListProbeAccounts")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-probe-account"],
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
    });
    expect(
      isIamActionResourceCompatible("quyan:relay:ListProbeAccounts", platformRelayProbeAccountArn("account")),
    ).toBe(true);
  });
  it("ignores client action input and passes the safe projection callback", async () => {
    expect(await service.list(request(), map, legacy)).toEqual(["fixture-native"]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListProbeAccounts" }),
    );
    expect(repository.list).toHaveBeenCalledWith(expect.anything(), expect.any(Function), expect.any(Function), map);
  });
  it("rejects missing and delegated principals", async () => {
    await expect(service.list(undefined, map, legacy)).rejects.toMatchObject({ statusCode: 403 });
    const delegated = request();
    delegated.authContext!.principalUserId = "issuer";
    await expect(service.list(delegated, map, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("requires stable platform membership and policy data", async () => {
    snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(service.list(request(), map, legacy)).rejects.toThrow();
    snapshots.recheck.mockResolvedValue(undefined);
    iam.loadPolicies.mockResolvedValueOnce([]).mockResolvedValue([
      {
        policyId: "changed",
        document: {
          Version: "1",
          Statement: { Effect: "Deny", Action: "quyan:relay:ListProbeAccounts", Resource: "*" },
        },
      },
    ]);
    await expect(service.list(request(), map, legacy)).rejects.toThrow();
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy permission enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    repository.list.mockRejectedValue(new Error("fixture denied"));
    expect(await service.list(request(), map, legacy)).toEqual(["fixture-legacy"]);
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list(request(), map, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projects only public configuration and credential/session presence", () => {
    const row = {
      id: "account",
      name: "A",
      tokenPath: "data.token",
      expiresPath: null,
      expiresMode: null,
      fallbackTtlSeconds: 30,
      minLoginIntervalSeconds: 60,
      lastLoginAttemptAt: new Date(0),
      hasCredentials: true,
      encryptedCredentials: "fixture-ciphertext",
      credentialIv: "fixture-iv",
      credentialAuthTag: "fixture-tag",
    };
    const projected = projectRelayProbeAccount(row, true);
    expect(projected).toMatchObject({ hasCredentials: true, cached: true, nextLoginAt: new Date(60000) });
    expect(JSON.stringify(projected)).not.toContain("fixture-");
  });
});
