import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import {
  Permission,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { PlatformMonthlyPassUsageReadIamService } from "@/services/billing/platform-monthly-pass-usage-read-iam.service";
import { platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import type { MonthlyPassUsageReadTarget } from "@/store/billing/platform-monthly-pass-usage-read.store";
const action = "quyan:monthly_pass:ListUsages",
  originalMode = env.security.iamAuthorizationMode;
const repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformMonthlyPassUsageReadIamService(repository, iam, snapshots, permissions);
let rows: MonthlyPassUsageReadTarget[], denied: Set<string>;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "192.0.2.1",
  }) as unknown as TypedRequest;
const target = (id: string, index: number): MonthlyPassUsageReadTarget => ({
  id,
  userId: "customer",
  passId: "pass",
  templateId: "template",
  status: 1,
  createTime: new Date(10000 - index),
  updateTime: new Date(20000),
  revision: "a".repeat(64),
});
const read = (page = 1, pageSize = 20, req = request()) =>
  service.list(req, { page, pageSize }, {}, (view) => view, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target("newer", 0), target("older", 1)];
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
  repository.scan.mockImplementation(async (_filters, after) => (after ? [] : rows.map((row) => ({ ...row }))));
  repository.hydrate.mockImplementation(async (_principal, page) =>
    page.map(({ target, templateName }: any) => ({
      record: { id: target.id, userId: target.userId, userMonthlyPassId: target.passId },
      templateId: target.templateId,
      ...(templateName ? { templateName: "fixture template" } : {}),
    })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 99, records: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
describe("monthly pass usage collection authorization", () => {
  it("registers the real endpoint and fixed resource types with its legacy alias", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.MONTHLY_PASS_USAGE_READ,
    });
    expect(iamActionsForLegacyPermission(Permission.MONTHLY_PASS_USAGE_READ)).toContain(action);
    expect(isIamActionResourceCompatible(action, platformMonthlyPassUsageArn("customer", "pass", "usage"))).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/customer")).toBe(false);
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.method === "listUsages"),
    ).toMatchObject({
      actions: [action],
      coverage: "explicit",
    });
  });
  it("counts and paginates allowed records before hydration", async () => {
    denied.add(platformMonthlyPassUsageArn("customer", "pass", "newer"));
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ record: { id: "older" } }] });
    expect(repository.hydrate.mock.calls[0]![1]).toHaveLength(1);
    expect(legacy).not.toHaveBeenCalled();
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
  });
  it("returns an empty result for an implicit deny", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("does not hydrate a denied template name", async () => {
    denied.add(platformTemplateArn("monthly-pass", "template"));
    expect((await read()).records[0]).not.toHaveProperty("templateName");
    expect(repository.hydrate.mock.calls[0]![1][0]).toMatchObject({ templateName: false });
  });
  it("rejects a store which returns denied template content", async () => {
    denied.add(platformTemplateArn("monthly-pass", "template"));
    repository.hydrate.mockResolvedValue([
      {
        record: { id: "newer", userId: "customer", userMonthlyPassId: "pass" },
        templateId: "template",
        templateName: "leaked",
      },
      { record: { id: "older", userId: "customer", userMonthlyPassId: "pass" }, templateId: "template" },
    ]);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a primary revision change even when updateTime is unchanged", async () => {
    repository.hydrate.mockImplementation(async () => {
      rows[0]!.revision = "b".repeat(64);
      return rows.map((target) => ({
        record: { id: target.id, userId: target.userId, userMonthlyPassId: target.passId },
        templateId: target.templateId,
        templateName: "fixture template",
      }));
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a template decision change during hydration", async () => {
    repository.hydrate.mockImplementation(async () => {
      denied.add(platformTemplateArn("monthly-pass", "template"));
      return rows.map((target) => ({
        record: { id: target.id, userId: target.userId, userMonthlyPassId: target.passId },
        templateId: target.templateId,
        templateName: "fixture template",
      }));
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([0, -1, 101])("rejects unsafe page size %s", async (size) => {
    await expect(read(1, size)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rejects missing identity and OAuth access tokens", async () => {
    await expect(read(1, 20, {} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    await expect(read(1, 20, { ...request(), oauthAccessToken: {} } as TypedRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("requires the platform qualification snapshot", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("denied"));
    await expect(read()).rejects.toThrow("denied");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("keeps legacy enforcement in legacy mode", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect((await read()).total).toBe(99);
    expect(repository.scan).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("records shadow authorization without changing the legacy response", async () => {
    env.security.iamAuthorizationMode = "shadow";
    denied.add(platformMonthlyPassUsageArn("customer", "pass", "newer"));
    expect((await read()).total).toBe(99);
    expect(repository.hydrate).toHaveBeenCalled();
  });
});
