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
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { PlatformTerminalEntitlementReadIamService } from "@/services/remote-terminal/platform-terminal-entitlement-read-iam.service";
import {
  platformTerminalEntitlementArn,
  platformTerminalBindingArn,
  platformTerminalRegistrationTokenArn,
} from "@/iam/resources/platform-terminal-entitlement-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type {
  TerminalEntitlementTarget,
  TerminalBindingReference,
  TerminalEntitlementProjection,
} from "@/store/remote-terminal-product/platform-terminal-entitlement-read.store";
const action = "quyan:remote_terminal:ListEntitlements",
  originalMode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), scanDevices: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformTerminalEntitlementReadIamService(repository, iam, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.30",
  }) as unknown as TypedRequest;
const target = (id: string, index: number, rank = index + 1): TerminalEntitlementTarget => ({
  id,
  userId: "customer",
  templateId: "template",
  assignedBy: "manager",
  tokenId: "token-" + id,
  status: 1,
  createTime: new Date(100000 - index),
  updateTime: new Date(200000),
  revision: "a".repeat(64),
  displayOrder: rank,
});
let rows: TerminalEntitlementTarget[], devices: TerminalBindingReference[], denied: Set<string>;
const read = (page = 1, pageSize = 20, req = request()) =>
  service.list(req, { page, pageSize }, {}, (view) => view, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target("newer", 0, 2), target("older", 1, 1)];
  devices = [{ id: "binding", userId: "customer", entitlementId: "older", status: 1 }];
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
  repository.scan.mockImplementation(async (_filters, after) =>
    rows.slice(
      after ? rows.findIndex((row) => row.id === after.id) + 1 : 0,
      (after ? rows.findIndex((row) => row.id === after.id) + 1 : 0) + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    ),
  );
  repository.scanDevices.mockImplementation(async (row, after) =>
    devices
      .filter((device) => device.entitlementId === row.id && (!after || device.id > after))
      .slice(0, IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
  );
  repository.hydrate.mockImplementation(
    async (_principal, page: { target: TerminalEntitlementTarget; projection: TerminalEntitlementProjection }[]) =>
      page.map(({ target, projection }) => ({ record: { id: target.id, userId: target.userId }, ...projection })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 7, records: [{ id: "legacy" }] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("platform terminal entitlement collection", () => {
  it("declares the server action and all related resource types", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.key === "GET /v1/remote-terminal/products/entitlements",
      ),
    ).toMatchObject({ coverage: "explicit", resourceKind: "collection", actions: [action], issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
    });
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ)).toContain(action);
    for (const arn of [
      platformTerminalEntitlementArn("customer", "older"),
      platformTerminalBindingArn("customer", "binding"),
      platformTerminalRegistrationTokenArn("customer", "older", "token"),
      platformTemplateArn("remote-terminal", "template"),
      platformUserArn("customer"),
    ])
      expect(isIamActionResourceCompatible(action, arn)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
  });
  it("hydrates only the admitted page in business order", async () => {
    const result = await read(1, 1);
    expect(result).toMatchObject({ total: 2, records: [{ record: { id: "older" } }], page: 1, pageSize: 1 });
    expect(repository.hydrate.mock.calls[0][1].map((row: any) => row.target.id)).toEqual(["older"]);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
    expect(iam.authorizeMany.mock.calls[0][0].context).toMatchObject({ "acs:SourceIp": "192.0.2.30" });
  });
  it("omits primary Deny from total and never scans its relations", async () => {
    denied.add(platformTerminalEntitlementArn("customer", "older"));
    expect(await read()).toMatchObject({ total: 1, records: [{ record: { id: "newer" } }] });
    expect(repository.scanDevices.mock.calls.every(([row]) => row.id !== "older")).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    [platformUserArn("customer"), "username"],
    [platformUserArn("manager"), "assignedByUsername"],
    [platformTemplateArn("remote-terminal", "template"), "templateName"],
    [platformTerminalRegistrationTokenArn("customer", "older", "token-older"), "tokenMetadata"],
  ])("omits related projection %s while preserving primary admission", async (arn, key) => {
    denied.add(arn);
    const result = await read(1, 1);
    expect(result.total).toBe(2);
    expect(repository.hydrate.mock.calls[0][1][0].projection[key]).toBe(false);
  });
  it("omits the complete device count when any binding is denied", async () => {
    denied.add(platformTerminalBindingArn("customer", "binding"));
    await read(1, 1);
    expect(repository.hydrate.mock.calls[0][1][0].projection).not.toHaveProperty("registeredDeviceCount");
  });
  it("counts all readable bindings and reports actual zero for no bindings", async () => {
    await read();
    expect(repository.hydrate.mock.calls[0][1].map((row: any) => row.projection.registeredDeviceCount)).toEqual([1, 0]);
  });
  it("traverses multiple primary and binding metadata batches", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 2 }, (_, index) => ({
      ...target("row-" + index, index),
      templateId: null,
      assignedBy: null,
      tokenId: null,
    }));
    devices = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 2 }, (_, index) => ({
      id: "binding-" + String(index).padStart(4, "0"),
      userId: "customer",
      entitlementId: "row-0",
      status: 1,
    }));
    expect(await read(1, 1)).toMatchObject({ total: rows.length });
    expect(repository.hydrate.mock.calls[0][1][0].projection.registeredDeviceCount).toBe(devices.length);
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) => input.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      ),
    ).toBe(true);
  });
  it.each(["owner", "entitlement", "cursor", "status"])("rejects invalid binding metadata %s", async (fault) => {
    devices = [
      {
        id: "binding",
        userId: fault === "owner" ? "other" : "customer",
        entitlementId: "older",
        status: fault === "status" ? -1 : 1,
      },
    ];
    if (fault === "entitlement") repository.scanDevices.mockResolvedValue([{ ...devices[0], entitlementId: "other" }]);
    if (fault === "cursor") devices.push({ ...devices[0]! });
    await expect(read()).rejects.toThrow();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("checks persisted management authority before metadata", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("global ceiling"));
    await expect(read()).rejects.toThrow("global ceiling");
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["source", "related-condition", "binding-condition", "binding-set", "identity", "policy"])(
    "rejects changed %s after hydration",
    async (fault) => {
      const hydrate = repository.hydrate.getMockImplementation()!;
      repository.hydrate.mockImplementationOnce(async (...args) => {
        const result = await hydrate(...args);
        if (fault === "source") rows = rows.map((row) => ({ ...row, revision: "b".repeat(64) }));
        if (fault === "related-condition") denied.add(platformUserArn("customer"));
        if (fault === "binding-condition") denied.add(platformTerminalBindingArn("customer", "binding"));
        if (fault === "binding-set") devices = [];
        if (fault === "identity") snapshots.recheck.mockRejectedValue(new Error("revoked identity"));
        if (fault === "policy")
          iam.loadPolicies.mockResolvedValue([
            {
              policyId: "changed",
              document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } },
            },
          ]);
        return result;
      });
      await expect(read()).rejects.toThrow();
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it("rejects incomplete or substituted hydration", async () => {
    repository.hydrate.mockResolvedValue([{ record: { id: "newer", userId: "other" } }]);
    await expect(read()).rejects.toThrow();
  });
  it("returns empty when there is no Allow without invoking legacy", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await read()).toMatchObject({ total: 0, records: [] });
    expect(repository.scanDevices).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy enforcement in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    expect(await read()).toMatchObject({ total: 7, records: [{ id: "legacy" }] });
    expect(permissions.checkUserPermissions).toHaveBeenCalled();
  });
  it("rejects legacy permission denial in shadow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("never falls back when the native decision engine is unavailable", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([{ results: [] }, { results: [{ decision: "invalid" }] }])(
    "rejects malformed decision results %j",
    async ({ results }) => {
      iam.authorizeMany.mockResolvedValue(results);
      await expect(read()).rejects.toThrow();
    },
  );
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1.5, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
  ])("rejects pagination %j", async ({ page, pageSize }) => {
    await expect(read(page, pageSize)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "impersonation", "mode"])("rejects untrusted request %s", async (fault) => {
    const req = request();
    if (fault === "missing") delete req.authContext;
    if (fault === "oauth") req.oauthAccessToken = {} as any;
    if (fault === "impersonation") req.authContext!.principalUserId = "other";
    if (fault === "mode") env.security.iamAuthorizationMode = "invalid" as any;
    await expect(read(1, 20, req)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
});
