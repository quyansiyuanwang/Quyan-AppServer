import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformTerminalEntitlementUpdateIamService } from "@/services/remote-terminal/platform-terminal-entitlement-update-iam.service";
import { terminalEntitlementUpdateRevision } from "@/store/remote-terminal-product/platform-terminal-entitlement-update.repository";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { target: vi.fn(), update: vi.fn() },
  owners = { owner: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformTerminalEntitlementUpdateIamService(iam, repository, owners, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
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
  owners.owner.mockResolvedValue("customer");
  repository.target.mockResolvedValue({ record: { id: "entry", userId: "customer" } });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal entitlement update authority", () => {
  it("declares the endpoint and additional deletion action in the catalog", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "PUT /v1/remote-terminal/products/entitlements/{id}",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:remote_terminal:UpdateEntitlement"], issues: [] });
    expect(getIamActionDefinition("quyan:remote_terminal:UpdateEntitlement")).toMatchObject({
      legacyPermission: Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE,
      authorizationBoundary: "platform",
      conditionalActions: ["quyan:remote_terminal:DeleteEntitlement"],
    });
    expect(
      isIamActionResourceCompatible(
        "quyan:remote_terminal:UpdateEntitlement",
        "acs:platform:*:platform:remote-terminal-entitlement/customer/entry",
      ),
    ).toBe(true);
    expect(
      isIamActionResourceCompatible("quyan:remote_terminal:UpdateEntitlement", "acs:quyan:*:owner:user/actor"),
    ).toBe(false);
  });
  it("requires deletion permission for status deletion and uses the persisted owner", async () => {
    await service.prepare("actor", request(), "entry", true);
    expect(
      iam.authorize.mock.calls.every(
        ([input]) => input.resource === "acs:platform:*:platform:remote-terminal-entitlement/customer/entry",
      ),
    ).toBe(true);
    expect(iam.authorize.mock.calls.map(([input]) => input.action)).toContain(
      "quyan:remote_terminal:DeleteEntitlement",
    );
  });
  it("rejects deletion denial before reading entitlement metadata", async () => {
    iam.authorize.mockImplementation(async ({ action }) => ({
      decision: action.endsWith(":DeleteEntitlement") ? "ExplicitDeny" : "Allow",
      matchedStatements: [],
    }));
    await expect(service.prepare("actor", request(), "entry", true)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("rejects source ownership changes", async () => {
    repository.target.mockResolvedValue({ record: { id: "entry", userId: "other" } });
    await expect(service.prepare("actor", request(), "entry")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["targetId", "targetUserId", "operation", "deleteViaUpdate"])(
    "binds %s into the commit guard",
    async (key) => {
      const result = await service.prepare("actor", request(), "entry");
      Object.assign(result!.guard, { [key]: key === "deleteViaUpdate" ? true : "other" });
      await expect(result!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("reevaluates conditions and refuses unavailable policy reads at commit", async () => {
    const result = await service.prepare("actor", request(), "entry");
    iam.authorize.mockRejectedValue(new Error("unavailable"));
    await expect(result!.guard.users.recheck()).rejects.toThrow("unavailable");
  });
  it("preserves shadow legacy checks without returning a native write guard", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    expect(await service.prepare("actor", request(), "entry")).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalled();
  });
  it.each(["shadow", "enforce"] as const)("refuses missing request in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await expect(service.prepare("actor", undefined, "entry")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fingerprints device membership independent of order", () => {
    const target = {
      record: { id: "entry" },
      deviceIds: ["a", "b"],
      user: { id: "customer" },
    } as unknown as Parameters<typeof terminalEntitlementUpdateRevision>[0];
    expect(terminalEntitlementUpdateRevision(target)).toBe(
      terminalEntitlementUpdateRevision({ ...target, deviceIds: ["b", "a"] }),
    );
    expect(terminalEntitlementUpdateRevision(target)).not.toBe(
      terminalEntitlementUpdateRevision({ ...target, deviceIds: ["a"] }),
    );
  });
});
