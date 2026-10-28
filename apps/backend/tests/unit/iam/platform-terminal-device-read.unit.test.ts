import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import {
  Permission,
  IAM_ACTION_DEFINITIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { PlatformTerminalDeviceReadIamService } from "@/services/remote-terminal/platform-terminal-device-read-iam.service";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type {
  TerminalDeviceTarget,
  TerminalDeviceProjection,
} from "@/store/remote-terminal-product/platform-terminal-device-read.store";
const action = "quyan:remote_terminal:ListDeviceBindings",
  originalMode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformTerminalDeviceReadIamService(repository, iam, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.30",
  }) as unknown as TypedRequest;
const target = (id: string, index: number, rank = index + 1): TerminalDeviceTarget => ({
  id,
  userId: "customer",
  entitlementId: "entitlement",
  entitlementUserId: "customer",
  status: 1,
  createTime: new Date(100000 - index),
  updateTime: new Date(200000),
  revision: "a".repeat(64),
  displayOrder: rank,
});
let rows: TerminalDeviceTarget[], denied: Set<string>;
const read = (page = 1, pageSize = 20, req = request()) =>
  service.list(req, { page, pageSize }, {}, (view) => view, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target("newer", 0, 2), target("older", 1, 1)];
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockImplementation(async (filters) => filters);
  repository.scan.mockImplementation(async (_filters, after) => {
    const start = after ? rows.findIndex((row) => row.id === after.id) + 1 : 0;
    return rows.slice(start, start + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  repository.hydrate.mockImplementation(
    async (_principal, page: { target: TerminalDeviceTarget; projection: TerminalDeviceProjection }[]) =>
      page.map(({ target, projection }) => ({ record: { id: target.id, userId: target.userId }, ...projection })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 7, records: [{ id: "legacy" }] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("platform terminal device collection", () => {
  it("declares the server action, platform scope and related resources", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.key === "GET /v1/remote-terminal/products/devices",
      ),
    ).toMatchObject({ coverage: "explicit", resourceKind: "collection", actions: [action], issues: [] });
    expect(IAM_ACTION_DEFINITIONS.filter((definition) => definition.action === action)).toHaveLength(1);
    expect(getIamActionDefinition("quyan:remote_terminal:ListDevices")).toMatchObject({
      legacyPermission: Permission.REMOTE_TERMINAL_DEVICE_READ,
      resourceTypes: ["quyan/user", "remote-terminal/device"],
    });
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
    });
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ)).toContain(action);
    for (const resource of [
      platformTerminalBindingArn("customer", "device"),
      platformTerminalEntitlementArn("customer", "entitlement"),
      platformUserArn("customer"),
    ])
      expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:device/device")).toBe(false);
  });
  it("hydrates only the admitted page in last-seen order", async () => {
    expect(await read(1, 1)).toMatchObject({ total: 2, records: [{ record: { id: "older" } }] });
    expect(repository.hydrate.mock.calls[0][1].map((row: any) => row.target.id)).toEqual(["older"]);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
    expect(iam.authorizeMany.mock.calls[0][0].context).toMatchObject({ "acs:SourceIp": "192.0.2.30" });
  });
  it("filters primary Deny before counting or hydration", async () => {
    denied.add(platformTerminalBindingArn("customer", "older"));
    expect(await read()).toMatchObject({ total: 1, records: [{ record: { id: "newer" } }] });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    [platformUserArn("customer"), "username"],
    [platformTerminalEntitlementArn("customer", "entitlement"), "entitlementName"],
  ])("omits denied relation %s", async (resource, key) => {
    denied.add(resource);
    await read(1, 1);
    expect(repository.hydrate.mock.calls[0][1][0].projection[key]).toBe(false);
  });
  it("traverses all bounded metadata pages before selecting an authorized page", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 2 }, (_, index) =>
      target("row-" + index, index),
    );
    denied.add(platformTerminalBindingArn("customer", "row-0"));
    const result = await read(6, 100);
    expect(result.total).toBe(rows.length - 1);
    expect(result.records).toHaveLength(1);
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) => input.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      ),
    ).toBe(true);
  });
  it("requires a persisted global management ceiling before metadata", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("global ceiling"));
    await expect(read()).rejects.toThrow("global ceiling");
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rejects a device bound to an entitlement of a different user", async () => {
    rows[0]!.entitlementUserId = "other";
    await expect(read()).rejects.toThrow();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["source", "user-condition", "entitlement-condition", "policy", "identity"])(
    "rejects %s changes after hydration",
    async (fault) => {
      const hydrate = repository.hydrate.getMockImplementation()!;
      repository.hydrate.mockImplementationOnce(async (...args) => {
        const result = await hydrate(...args);
        if (fault === "source") rows = rows.map((row) => ({ ...row, revision: "b".repeat(64) }));
        if (fault === "user-condition") denied.add(platformUserArn("customer"));
        if (fault === "entitlement-condition") denied.add(platformTerminalEntitlementArn("customer", "entitlement"));
        if (fault === "policy")
          iam.loadPolicies.mockResolvedValue([
            {
              policyId: "changed",
              document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } },
            },
          ]);
        if (fault === "identity") snapshots.recheck.mockRejectedValue(new Error("revoked"));
        return result;
      });
      await expect(read()).rejects.toThrow();
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it("rejects reordered or substituted hydration", async () => {
    repository.hydrate.mockResolvedValue([{ record: { id: "newer", userId: "other" } }]);
    await expect(read()).rejects.toThrow();
  });
  it("rejects malformed related decisions", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource.includes(":user/") ? "Unknown" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(read()).rejects.toThrow();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("returns empty without a matching Allow and never calls legacy", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await read()).toMatchObject({ total: 0, records: [] });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains legacy enforcement in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    expect(await read()).toMatchObject({ total: 7, records: [{ id: "legacy" }] });
    expect(permissions.checkUserPermissions).toHaveBeenCalled();
  });
  it("does not bypass legacy denial in shadow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("never falls back after enforce failure", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1.5, pageSize: 20 },
    { page: 1, pageSize: 101 },
  ])("rejects pagination %j", async ({ page, pageSize }) => {
    await expect(read(page, pageSize)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "impersonation", "mode"])("rejects untrusted context %s", async (fault) => {
    const req = request();
    if (fault === "missing") delete req.authContext;
    if (fault === "oauth") req.oauthAccessToken = {} as any;
    if (fault === "impersonation") req.authContext!.principalUserId = "other";
    if (fault === "mode") env.security.iamAuthorizationMode = "invalid" as any;
    await expect(read(1, 20, req)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
});
