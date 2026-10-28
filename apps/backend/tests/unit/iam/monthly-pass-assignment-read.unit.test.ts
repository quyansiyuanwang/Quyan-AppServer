import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { PlatformMonthlyPassAssignmentReadIamService } from "@/services/billing/platform-monthly-pass-assignment-read-iam.service";
import { platformMonthlyPassArn, platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import type {
  MonthlyPassAssignmentReadTarget,
  MonthlyPassAssignmentUsageReference,
} from "@/store/billing/platform-monthly-pass-assignment-read.store";
const originalMode = env.security.iamAuthorizationMode,
  action = "quyan:monthly_pass:ListUserPasses",
  limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
const repository = { where: vi.fn(), scan: vi.fn(), scanUsages: vi.fn(), hydrate: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformMonthlyPassAssignmentReadIamService(repository, iam, snapshots, permissions);
let rows: MonthlyPassAssignmentReadTarget[], usages: MonthlyPassAssignmentUsageReference[], denied: Set<string>;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.50",
  }) as unknown as TypedRequest;
const target = (id: string, index: number, rank = index + 1): MonthlyPassAssignmentReadTarget => ({
  id,
  userId: "customer",
  templateId: "template",
  status: 1,
  createTime: new Date(100000 - index),
  updateTime: new Date(200000),
  revision: "a".repeat(64),
  displayOrder: rank,
});
const read = (page = 1, pageSize = 20) => service.list(request(), { page, pageSize }, {}, (view) => view, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target("newer", 0, 2), target("older", 1, 1)];
  usages = [{ id: "usage", userId: "customer", userMonthlyPassId: "older", status: 1 }];
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
    const index = after ? rows.findIndex((row) => row.id === after.id) + 1 : 0;
    return rows.slice(index, index + limit).map((row) => ({ ...row }));
  });
  repository.scanUsages.mockImplementation(async (target, after) =>
    usages.filter((row) => row.userMonthlyPassId === target.id && (!after || row.id > after)).slice(0, limit),
  );
  repository.hydrate.mockImplementation(async (_principal, page) =>
    page.map(({ target, projection }: any) => ({
      record: {
        id: target.id,
        userId: target.userId,
        templateId: target.templateId,
        user: { username: projection.username ? "fixture user" : "" },
        template: projection.template
          ? { name: "fixture template", description: "fixture description", allowedModels: "[]", allowedChannels: "[]" }
          : { name: "", description: null, allowedModels: null, allowedChannels: null },
      },
      quotaUsage: projection.quotaUsage,
    })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 99, records: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
describe("monthly pass assignment collection", () => {
  it("declares the fixed endpoint, platform ceiling and registered child resources", () => {
    expect(getIamActionDefinition(action)).toMatchObject({ authorizationBoundary: "platform" });
    expect(isIamActionResourceCompatible(action, platformMonthlyPassArn("customer", "pass"))).toBe(true);
    expect(isIamActionResourceCompatible(action, platformMonthlyPassUsageArn("customer", "pass", "usage"))).toBe(true);
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.method === "listUserPasses"),
    ).toMatchObject({ coverage: "explicit", actions: [action] });
  });
  it("paginates allowed records in the business order", async () => {
    expect(await read(1, 1)).toMatchObject({ total: 2, records: [{ record: { id: "older" } }] });
    expect(await read(2, 1)).toMatchObject({ records: [{ record: { id: "newer" } }] });
  });
  it("omits primary Deny from counts and never scans its usages", async () => {
    denied.add(platformMonthlyPassArn("customer", "older"));
    expect(await read()).toMatchObject({ total: 1, records: [{ record: { id: "newer" } }] });
    expect(repository.scanUsages.mock.calls.every(([target]) => target.id !== "older")).toBe(true);
  });
  it.each([
    [platformUserArn("customer"), "username"],
    [platformTemplateArn("monthly-pass", "template"), "template"],
  ])("withholds related contribution %s", async (arn, key) => {
    denied.add(arn);
    await read(1, 1);
    expect(repository.hydrate.mock.calls[0]![1][0].projection[key]).toBe(false);
  });
  it("withholds complete window usage if any child usage is denied", async () => {
    denied.add(platformMonthlyPassUsageArn("customer", "older", "usage"));
    const result = await read(1, 1);
    expect(result.records[0]?.quotaUsage).toBe(false);
    expect(result.total).toBe(2);
  });
  it("traverses multiple metadata batches and never sends an oversized authorization request", async () => {
    rows = Array.from({ length: limit + 2 }, (_, index) => target("pass-" + index, index));
    usages = Array.from({ length: limit + 2 }, (_, index) => ({
      id: "usage-" + String(index).padStart(4, "0"),
      userId: "customer",
      userMonthlyPassId: "pass-0",
      status: 1,
    }));
    expect((await read(1, 1)).total).toBe(limit + 2);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.resources.length <= limit)).toBe(true);
  });
  it("rejects cross-owner usage references", async () => {
    usages[0]!.userId = "other";
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects primary revision drift during hydration", async () => {
    const hydrate = repository.hydrate.getMockImplementation()!;
    repository.hydrate.mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      rows[0]!.revision = "b".repeat(64);
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a child decision change during hydration", async () => {
    const hydrate = repository.hydrate.getMockImplementation()!;
    repository.hydrate.mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      denied.add(platformMonthlyPassUsageArn("customer", "older", "usage"));
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns no records for a missing Allow", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("fails when the persisted platform qualification is missing", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("denied"));
    await expect(read()).rejects.toThrow("denied");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("keeps legacy enforcement in both legacy and shadow modes", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect((await read()).total).toBe(99);
    expect(repository.scan).not.toHaveBeenCalled();
    env.security.iamAuthorizationMode = "shadow";
    denied.add(platformMonthlyPassArn("customer", "older"));
    expect((await read()).total).toBe(99);
    expect(repository.hydrate).toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
});
