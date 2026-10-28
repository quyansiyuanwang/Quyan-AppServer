import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolOrderWriteIamService } from "@/services/billing/platform-carpool-order-write-iam.service";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { findOrderManagementTarget: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformCarpoolOrderWriteIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const prepare = () => service.prepare("actor", request(), "order");
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  repository.findOrderManagementTarget.mockResolvedValue({ id: "order", state: "submitted", status: 1, members: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("carpool order acceptance authority", () => {
  it("registers the real route with a server Action and a platform order target", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/carpools/admin/{id}/accept",
      ),
    ).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:carpool:AcceptOrder"],
      resourceKind: "single-resource",
      issues: [],
    });
    expect(getIamActionDefinition("quyan:carpool:AcceptOrder")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.CARPOOL_ORDER_FULFILL,
    });
    expect(isIamActionResourceCompatible("quyan:carpool:AcceptOrder", platformCarpoolOrderArn("order"))).toBe(true);
    const guard = await prepare();
    expect(guard?.target.record.id).toBe("order");
    expect(
      iam.authorize.mock.calls.every(
        ([input]) =>
          input.action === "quyan:carpool:AcceptOrder" && input.resource === platformCarpoolOrderArn("order"),
      ),
    ).toBe(true);
  });
  it("does not read denied order contents", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findOrderManagementTarget).not.toHaveBeenCalled();
  });
  it("requires persisted management qualification before source reads", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture unavailable qualification"));
    await expect(prepare()).rejects.toThrow();
    expect(repository.findOrderManagementTarget).not.toHaveBeenCalled();
  });
  it("rechecks authority and fails closed on stale qualification or decisions", async () => {
    const guard = await prepare();
    iam.authorize.mockResolvedValue(undefined);
    await expect(guard!.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing or mismatched identity, invalid IDs and unsupported modes", async () => {
    await expect(service.prepare("actor", undefined, "order")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("other", request(), "order")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("actor", request(), "../invalid")).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    iam.authorize.mockRejectedValue(new Error("fixture native unavailable"));
    expect(await prepare()).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.CARPOOL_ORDER_FULFILL],
      expect.anything(),
    );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
});
