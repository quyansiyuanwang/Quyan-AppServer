import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolDeliveryChannelReadIamService } from "@/services/billing/platform-carpool-delivery-channel-read-iam.service";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = { list: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformCarpoolDeliveryChannelReadIamService(iam, repository, snapshots, permissions);
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
    return { records: [], total: 1 };
  });
  legacy.mockResolvedValue({ total: 7, records: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("delivery channel authorization", () => {
  it("registers an explicit fixed Action for channels and source orders", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    const action = "quyan:carpool:ListDeliveryChannels";
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/carpools/admin/delivery-channels",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.CARPOOL_ORDER_FULFILL,
    });
    expect(isIamActionResourceCompatible(action, platformCarpoolOrderArn("order"))).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:relay-channel/channel")).toBe(true);
  });
  it("passes source order and uses server Action despite forged header", async () => {
    await service.list(request(), { page: 1, pageSize: 20, orderId: "order" }, legacy);
    expect(repository.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order" }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:carpool:ListDeliveryChannels" }),
    );
  });
  it("rejects missing and delegated identities and malformed queries", async () => {
    await expect(service.list(undefined, { page: 1, pageSize: 20 }, legacy)).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.oauthAccessToken = {} as NonNullable<TypedRequest["oauthAccessToken"]>;
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(request(), { page: 1, pageSize: 101 }, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("requires stable global qualification and policy fingerprint through read", async () => {
    snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(list()).rejects.toThrow();
    snapshots.recheck.mockResolvedValue(undefined);
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ policyId: "changed" }]);
    await expect(list()).rejects.toThrow();
  });
  it.each(["legacy", "shadow"] as const)("retains legacy qualification in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    repository.list.mockRejectedValue(new Error("fixture denied"));
    expect(await list()).toMatchObject({ total: 7 });
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.CARPOOL_ORDER_FULFILL],
      expect.anything(),
    );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
});
