import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolOrderReadIamService } from "@/services/billing/platform-carpool-order-read-iam.service";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { platformCarpoolOrderResource } from "@/iam/request/platform-carpool-order-resource-resolvers";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = { list: vi.fn(), get: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformCarpoolOrderReadIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    params: { id: "order" },
    secure: true,
  }) as unknown as TypedRequest;
const list = (req = request()) => service.list(req, { page: 1, pageSize: 20 }, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ users: [], group: { id: "global", updateTime: new Date(0) } });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  repository.list.mockImplementation(async (_p, _f, decide, recheck) => {
    await decide([platformCarpoolOrderArn("order")]);
    await recheck();
    return { records: [], total: 1, stateCounts: { accepted: 1 } };
  });
  repository.get.mockImplementation(async (_p, id, decide, recheck) => {
    await decide([platformCarpoolOrderArn(id)]);
    await recheck();
    return { id };
  });
  legacy.mockResolvedValue({ total: 7, records: [], stateCounts: {} });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("carpool operations read authority", () => {
  it("separates management reads from member resources and client Action overrides", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [path, operation, kind] of [
      ["GET /v1/carpools/admin", "ListAdminOrders", "collection"],
      ["GET /v1/carpools/admin/{id}", "GetAdminOrder", "single-resource"],
    ]) {
      const action = "quyan:carpool:" + operation;
      expect(routes.find((row) => row.key === path)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        resourceKind: kind,
        issues: [],
      });
      expect(getIamActionDefinition(action)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: Permission.CARPOOL_ORDER_READ,
      });
      expect(isIamActionResourceCompatible(action, platformCarpoolOrderArn("order"))).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:carpool:*:owner:order/order")).toBe(false);
    }
    await list();
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:carpool:ListAdminOrders")).toBe(
      true,
    );
  });
  it("resolves only a server platform order ARN", async () => {
    expect(await platformCarpoolOrderResource({ request: request(), principal: {} as never })).toBe(
      platformCarpoolOrderArn("order"),
    );
    const invalid = request();
    invalid.params.id = "../invalid";
    expect(await platformCarpoolOrderResource({ request: invalid, principal: {} as never })).toBeUndefined();
  });
  it("checks management eligibility before reading order metadata", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture no qualification"));
    await expect(list()).rejects.toThrow();
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("fails closed on absent context, unsupported mode, invalid filters and missing decisions", async () => {
    await expect(service.list(undefined, { page: 1, pageSize: 20 }, legacy)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(request(), { page: 1, pageSize: 20, state: "invalid" }, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("forwards the distinct detail Action and rechecks policy after native reads", async () => {
    expect(await service.get(request(), "order", legacy)).toEqual({ id: "order" });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:carpool:GetAdminOrder", resources: [platformCarpoolOrderArn("order")] }),
    );
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ policyId: "changed" }]);
    await expect(list()).rejects.toThrow();
  });
  it.each(["legacy", "shadow"] as const)("retains legacy enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    repository.list.mockRejectedValue(new Error("fixture refused"));
    expect(await list()).toMatchObject({ total: 7 });
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.CARPOOL_ORDER_READ],
      expect.anything(),
    );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
});
