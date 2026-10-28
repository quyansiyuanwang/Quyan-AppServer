import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformTerminalEntitlementAssignIamService } from "@/services/remote-terminal/platform-terminal-entitlement-assign-iam.service";
import { platformTerminalEntitlementAssignResource } from "@/iam/request/platform-terminal-entitlement-assign-resource-resolver";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission, type IamPrincipal } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { user: vi.fn(), template: vi.fn(), create: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformTerminalEntitlementAssignIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    body: { userId: "customer", accountId: "untrusted" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const mode = env.security.iamAuthorizationMode;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] });
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.user.mockResolvedValue({ id: "customer", status: 1, accountOwnerId: null, updateTime: new Date(0) });
  repository.template.mockResolvedValue({ id: "template", status: 1, devicePrice: 1 });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal entitlement assignment authority", () => {
  it("declares the endpoint and all participating resources", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "POST /v1/remote-terminal/products/entitlements",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:remote_terminal:AssignEntitlement"], issues: [] });
    expect(getIamActionDefinition("quyan:remote_terminal:AssignEntitlement")).toMatchObject({
      legacyPermission: Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE,
      authorizationBoundary: "platform",
    });
    for (const resource of [
      "user/customer",
      "remote-terminal-template/template",
      "remote-terminal-entitlement/customer/entry",
    ])
      expect(
        isIamActionResourceCompatible("quyan:remote_terminal:AssignEntitlement", "acs:platform:*:platform:" + resource),
      ).toBe(true);
  });
  it("resolves only the validated user in the platform namespace", async () => {
    expect(await platformTerminalEntitlementAssignResource({ request: request(), principal: {} as IamPrincipal })).toBe(
      "acs:platform:*:platform:user/customer",
    );
    const invalid = request();
    invalid.body = { userId: "*" } as never;
    expect(
      await platformTerminalEntitlementAssignResource({ request: invalid, principal: {} as IamPrincipal }),
    ).toBeUndefined();
  });
  it("requires user, optional template and generated entitlement authorization", async () => {
    const result = await service.prepare("actor", request(), "customer", "template");
    await result!.guard.recheckEntry("generated");
    expect(new Set(iam.authorize.mock.calls.map(([input]) => input.resource))).toEqual(
      new Set([
        "acs:platform:*:platform:user/customer",
        "acs:platform:*:platform:remote-terminal-template/template",
        "acs:platform:*:platform:remote-terminal-entitlement/customer/generated",
      ]),
    );
  });
  it.each(["user", "remote-terminal-template"])(
    "rejects %s denial before loading business data",
    async (resourceType) => {
      iam.authorize.mockImplementation(async ({ resource }) => ({
        decision: resource.includes(":" + resourceType + "/") ? "ExplicitDeny" : "Allow",
        matchedStatements: [],
      }));
      await expect(service.prepare("actor", request(), "customer", "template")).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(repository.user).not.toHaveBeenCalled();
      expect(repository.template).not.toHaveBeenCalled();
    },
  );
  it("rejects the newly generated entitlement after initially allowed user/template", async () => {
    const result = await service.prepare("actor", request(), "customer", "template");
    iam.authorize.mockImplementation(async ({ resource }) => ({
      decision: resource.includes("remote-terminal-entitlement") ? "ExplicitDeny" : "Allow",
    }));
    await expect(result!.guard.recheckEntry("generated")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["customer", "template", "operation"])("binds %s to the original commit guard", async (key) => {
    const result = await service.prepare("actor", request(), "customer", "template");
    if (key === "customer") result!.guard.customer.accountOwnerId = "other";
    if (key === "template") Object.assign(result!.guard.template!, { devicePrice: 3 });
    if (key === "operation") Object.assign(result!.guard, { operation: "other" });
    await expect(result!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains legacy enforcement in shadow mode", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    expect(await service.prepare("actor", request(), "customer")).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalled();
  });
  it.each(["shadow", "enforce"] as const)("refuses missing authentication context in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await expect(service.prepare("actor", undefined, "customer")).rejects.toMatchObject({ statusCode: 403 });
  });
});
