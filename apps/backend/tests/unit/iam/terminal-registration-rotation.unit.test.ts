import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { TerminalRegistrationRotationIamService } from "@/services/remote-terminal/terminal-registration-rotation-iam.service";
import { TERMINAL_REGISTRATION_METADATA_SELECT } from "@/store/remote-terminal-product/terminal-registration-rotation.repository";
import {
  platformTerminalEntitlementArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalProductRegistrationTokenArn,
} from "@/iam/resources/remote-terminal-resources";
import {
  IAM_TERMINAL_REGISTRATION_ROTATIONS,
  IAM_AUTHENTICATED_SELF_ACTIONS,
  authenticatedSelfResourcePatterns,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { owner: vi.fn(), target: vi.fn(), rotate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  accounts = { targets: vi.fn() };
const service = new TerminalRegistrationRotationIamService(iam, repository, snapshots, permissions, accounts);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    ip: "192.0.2.42",
    secure: true,
    params: { id: "entitlement" },
    body: { userId: "other", token: "CLIENT-TOKEN" },
  }) as unknown as TypedRequest;
const target = (userId: string) => ({
  id: "entitlement",
  userId,
  name: "fixture",
  status: 1,
  deviceLimit: 2,
  updateTime: new Date(0),
  registrationToken: null,
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
  repository.target.mockResolvedValue(target("customer"));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  accounts.targets.mockResolvedValue([
    { id: "actor", updateTime: new Date(0) },
    { id: "owner", updateTime: new Date(0) },
  ]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal registration credential resource authority", () => {
  it("declares actual endpoints with separate personal and management capabilities", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const entry of IAM_TERMINAL_REGISTRATION_ROTATIONS) {
      const action = "quyan:remote_terminal:" + entry.operation;
      expect(routes.find((route) => route.key === entry.route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      const parent = entry.management
        ? platformTerminalEntitlementArn("customer", "entitlement")
        : remoteTerminalProductEntitlementArn("owner", "actor", "entitlement");
      expect(isIamActionResourceCompatible(action, parent)).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:remote_terminal:RotateMyRegistrationToken");
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:remote_terminal:RotateRegistrationToken");
    expect(getIamActionDefinition("quyan:remote_terminal:RotateRegistrationToken")).toMatchObject({
      legacyPermission: Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE,
      authorizationBoundary: "platform",
    });
    expect(TERMINAL_REGISTRATION_METADATA_SELECT).not.toHaveProperty("token");
  });
  it("keeps three-level self grants bound to the first user segment and current account", () => {
    const policies = [
      {
        policyId: "self",
        document: parseIamPolicy({
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: [...IAM_AUTHENTICATED_SELF_ACTIONS],
            Resource: authenticatedSelfResourcePatterns("owner", "actor"),
          },
        }).document,
      },
    ];
    const action = "quyan:remote_terminal:RotateMyRegistrationToken";
    expect(
      evaluatePolicies(policies, {
        action,
        resource: remoteTerminalProductRegistrationTokenArn("owner", "actor", "entitlement", "token"),
      }).decision,
    ).toBe("Allow");
    for (const [account, user, entitlement] of [
      ["owner", "peer", "entitlement"],
      ["owner", "peer", "actor"],
      ["other", "actor", "entitlement"],
    ]) {
      expect(
        evaluatePolicies(policies, {
          action,
          resource: remoteTerminalProductRegistrationTokenArn(account!, user!, entitlement!, "token"),
        }).decision,
      ).toBe("ImplicitDeny");
    }
  });
  it("checks management parent authority before loading mutation fields and new token authority afterward", async () => {
    const source = await service.prepare("RotateRegistrationToken", "actor", request(), "entitlement");
    expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(repository.target.mock.invocationCallOrder[0]!);
    await source!.guard.recheckToken("new-token");
    expect(iam.authorize.mock.calls.map(([input]) => input.resource)).toContain(
      platformTerminalRegistrationTokenArn("customer", "entitlement", "new-token"),
    );
    expect(iam.authorize.mock.calls[0][0]).toMatchObject({
      action: "quyan:remote_terminal:RotateRegistrationToken",
      resource: platformTerminalEntitlementArn("customer", "entitlement"),
    });
  });
  it("checks account-owned personal token resources without the global management ceiling", async () => {
    repository.owner.mockResolvedValue("actor");
    repository.target.mockResolvedValue(target("actor"));
    const source = await service.prepare("RotateMyRegistrationToken", "actor", request(), "entitlement");
    await source!.guard.recheckToken("new-token");
    expect(iam.authorize.mock.calls.map(([input]) => input.resource)).toContain(
      remoteTerminalProductRegistrationTokenArn("owner", "actor", "entitlement", "new-token"),
    );
    expect(snapshots.snapshot).not.toHaveBeenCalled();
    expect(permissions.checkUserPermissions).not.toHaveBeenCalled();
  });
  it("refuses parent denial before loading token metadata", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("refuses existing token denial before opening a write transaction", async () => {
    repository.target.mockResolvedValue({
      ...target("customer"),
      registrationToken: { id: "token", entitlementId: "entitlement" },
    });
    iam.authorize.mockImplementation(async ({ resource }) => ({
      decision: resource.includes("registration-token/") ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    }));
    await expect(service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.rotate).not.toHaveBeenCalled();
  });
  it("refuses missing resources, changed owners and cross-user personal rotation", async () => {
    await expect(service.prepare("RotateMyRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject(
      { statusCode: 403 },
    );
    repository.target.mockResolvedValue(target("changed"));
    await expect(service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.owner.mockResolvedValue(undefined);
    await expect(service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("refuses operation relabeling and fresh policy changes", async () => {
    const source = await service.prepare("RotateRegistrationToken", "actor", request(), "entitlement");
    source!.guard.operation = "RotateMyRegistrationToken";
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    source!.guard.operation = "RotateRegistrationToken";
    iam.loadPolicies.mockResolvedValue([
      { policyId: "changed", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
    ]);
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "retains %s management permission checks and personal ownership behavior",
    async (value) => {
      env.security.iamAuthorizationMode = value;
      iam.authorize.mockRejectedValue(new Error("fixture unavailable"));
      expect(await service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).toBeUndefined();
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.prepare("RotateRegistrationToken", "actor", request(), "entitlement")).rejects.toMatchObject(
        { statusCode: 403 },
      );
      expect(await service.prepare("RotateMyRegistrationToken", "actor", request(), "entitlement")).toBeUndefined();
    },
  );
  it("refuses malformed identifiers and missing trusted identity", async () => {
    await expect(service.prepare("RotateRegistrationToken", "actor", request(), "bad/id")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("RotateRegistrationToken", "actor", undefined, "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("RotateRegistrationToken", "other", request(), "entitlement")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
