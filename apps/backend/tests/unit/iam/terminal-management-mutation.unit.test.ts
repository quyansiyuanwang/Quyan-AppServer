import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformTerminalManagementMutationIamService } from "@/services/remote-terminal/platform-terminal-management-mutation-iam.service";
import {
  PlatformTerminalManagementMutationRepository,
  terminalManagementRevision,
} from "@/store/remote-terminal-product/platform-terminal-management-mutation.repository";
import {
  platformTerminalRevokeBindingResource,
  platformTerminalResetUnbindResource,
} from "@/iam/request/platform-terminal-management-mutation-resource-resolvers";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import {
  IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
  type IamPrincipal,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { owner: vi.fn(), target: vi.fn(), mutate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformTerminalManagementMutationIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    ip: "192.0.2.42",
    secure: true,
    params: { id: "entry" },
    body: { userId: "other", accountId: "other" },
  }) as unknown as TypedRequest;
const target = () => ({
  kind: "binding" as const,
  id: "entry",
  userId: "customer",
  status: 1,
  updateTime: new Date(0),
  label: "fixture host",
  entitlementId: "entitlement",
  online: true,
  revision: "a".repeat(64),
});
const mode = env.security.iamAuthorizationMode;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.owner.mockResolvedValue("customer");
  repository.target.mockResolvedValue(target());
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal management mutation authority", () => {
  it("registers explicit routes without changing personal runtime preference authorization", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const entry of IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS) {
      const action = "quyan:remote_terminal:" + entry.operation;
      expect(routes.find((route) => route.key === entry.route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      expect(getIamActionDefinition(action)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: entry.permission,
        resourceTypes: [entry.resourceType],
      });
      const arn =
        entry.kind === "binding"
          ? platformTerminalBindingArn("customer", "entry")
          : platformTerminalEntitlementArn("customer", "entry");
      expect(isIamActionResourceCompatible(action, arn)).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
    expect(getIamActionDefinition("quyan:remote_terminal:UpdateAgentPreferences")).toMatchObject({
      legacyPermission: Permission.REMOTE_TERMINAL_DEVICE_WRITE,
      resourceTypes: ["remote-terminal/device"],
    });
  });
  it.each(IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS)(
    "resolves persisted ownership for $operation before loading mutation fields",
    async (entry) => {
      repository.target.mockResolvedValue({ ...target(), kind: entry.kind });
      const result = await service.prepare(entry.operation, "actor", request(), "entry");
      const arn =
        entry.kind === "binding"
          ? platformTerminalBindingArn("customer", "entry")
          : platformTerminalEntitlementArn("customer", "entry");
      expect(iam.authorize.mock.calls[0][0]).toMatchObject({
        action: "quyan:remote_terminal:" + entry.operation,
        resource: arn,
        context: { "acs:SourceIp": "192.0.2.42" },
      });
      expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(repository.target.mock.invocationCallOrder[0]!);
      expect(result?.guard).toMatchObject({ operation: entry.operation, targetUserId: "customer", targetId: "entry" });
    },
  );
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s before loading mutation data", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("refuses a resource whose owner changed during authorization", async () => {
    repository.target.mockResolvedValue({ ...target(), userId: "different" });
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("refuses malformed or missing resources without a wildcard fallback", async () => {
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "../entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.owner.mockResolvedValue(undefined);
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(iam.authorize).not.toHaveBeenCalled();
  });
  it("retains policy, group and live condition rechecks in the transaction guard", async () => {
    const source = await service.prepare("RevokeDeviceBinding", "actor", request(), "entry");
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
    iam.loadPolicies.mockResolvedValue([
      { policyId: "changed", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
    ]);
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves %s permission enforcement on native failure", async (value) => {
    env.security.iamAuthorizationMode = value;
    iam.authorize.mockRejectedValue(new Error("fixture unavailable"));
    expect(await service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.REMOTE_TERMINAL_DEVICE_WRITE], {
      assumedRoleSessionId: undefined,
    });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects missing identity, actor spoofing, OAuth and invalid rollout mode", async () => {
    await expect(service.prepare("RevokeDeviceBinding", "actor", undefined, "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("RevokeDeviceBinding", "other", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    const oauth = request();
    oauth.oauthAccessToken = {} as typeof oauth.oauthAccessToken;
    await expect(service.prepare("RevokeDeviceBinding", "actor", oauth, "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "unknown" as typeof env.security.iamAuthorizationMode;
    await expect(service.prepare("RevokeDeviceBinding", "actor", request(), "entry")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("uses server ownership and operation in middleware resolvers", async () => {
    const owner = vi
      .spyOn(PlatformTerminalManagementMutationRepository.getInstance(), "owner")
      .mockResolvedValue("customer");
    const context = {
      request: request(),
      principal: {
        subjectUserId: "actor",
        principalUserId: "actor",
        accountOwnerId: "owner",
        subjectType: "sub_user",
      } as IamPrincipal,
    };
    expect(await platformTerminalRevokeBindingResource(context)).toBe(platformTerminalBindingArn("customer", "entry"));
    expect(owner).toHaveBeenCalledWith(context.principal, "RevokeDeviceBinding", "entry");
    expect(await platformTerminalResetUnbindResource(context)).toBe(
      platformTerminalEntitlementArn("customer", "entry"),
    );
    owner.mockResolvedValue(undefined);
    expect(await platformTerminalRevokeBindingResource(context)).toBeUndefined();
  });
  it("hashes mutation fields without depending on property insertion order", () => {
    const value = target();
    const reordered = { ...value, revision: "different" };
    expect(terminalManagementRevision(value)).toBe(terminalManagementRevision(reordered));
    expect(terminalManagementRevision({ ...value, online: false })).not.toBe(terminalManagementRevision(value));
    expect(terminalManagementRevision({ ...value, userId: "different" })).not.toBe(terminalManagementRevision(value));
  });
});
