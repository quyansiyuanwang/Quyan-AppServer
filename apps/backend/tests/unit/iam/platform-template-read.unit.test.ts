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
import { PlatformTemplateReadIamService } from "@/services/billing/platform-template-read-iam.service";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import {
  IAM_PLATFORM_TEMPLATE_DEFINITIONS,
  IAM_REMOTE_TERMINAL_TEMPLATE_OPTIONS_DEFINITION,
  Permission,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type { PlatformTemplateTarget } from "@/store/billing/platform-template-read.store";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn(),
  optionsRepository = { hydrateOptions: vi.fn() };
const originalMode = env.security.iamAuthorizationMode;
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
const service = new PlatformTemplateReadIamService(
  "remote-terminal",
  repository,
  iam,
  snapshots,
  permissions,
  optionsRepository,
);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const target = (id: string, index: number, rank = index + 1): PlatformTemplateTarget => ({
  id,
  status: 1,
  createTime: new Date(100000 - index),
  updateTime: new Date(200000),
  revision: "a".repeat(64),
  displayOrder: rank,
});
let rows: PlatformTemplateTarget[], denied: Set<string>;
const read = (page = 1, pageSize = 20, filters = {}) =>
  service.list(request(), { page, pageSize }, filters, (row) => ({ id: row.id }), legacy);
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
    const index = after ? rows.findIndex((row) => row.id === after.id) + 1 : 0;
    return rows.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  repository.hydrate.mockImplementation(async (_principal, targets) =>
    targets.map((row: PlatformTemplateTarget) => ({ id: row.id })),
  );
  optionsRepository.hydrateOptions.mockImplementation(async (_principal, targets) =>
    targets.map((row: PlatformTemplateTarget) => ({ id: row.id, name: row.id, status: 1, publishStatus: "draft" })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 7, records: [{ id: "legacy" }] });
});
describe("platform template list admission", () => {
  it("declares collection authorization for both real HTTP endpoints", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFilesAtPaths([
      "src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts",
      "src/api/controllers/v1/billing/carpool.controller.ts",
      "src/api/controllers/v1/billing/monthly-pass.controller.ts",
    ]);
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const definition of IAM_PLATFORM_TEMPLATE_DEFINITIONS) {
      expect(routes.find((route) => route.key === definition.route)).toMatchObject({
        coverage: "explicit",
        resourceKind: "collection",
        actions: [definition.action],
        issues: [],
      });
    }
  });
  it("registers both real read actions, distinct platform resources and migration aliases", () => {
    for (const definition of IAM_PLATFORM_TEMPLATE_DEFINITIONS) {
      expect(getIamActionDefinition(definition.action)).toMatchObject({
        authorizationBoundary: "platform",
        authorizationStage: "declared",
        apiRoutes: [definition.route],
      });
      expect(isIamActionResourceCompatible(definition.action, platformTemplateArn(definition.kind, "template"))).toBe(
        true,
      );
      expect(isIamActionResourceCompatible(definition.action, "acs:quyan:*:owner:user/actor")).toBe(false);
      expect(iamActionsForLegacyPermission(definition.legacyPermission)).toContain(definition.action);
    }
  });
  it("hydrates only the admitted page while retaining the domain display order", async () => {
    expect(await read(1, 1)).toMatchObject({ total: 2, records: [{ id: "older" }] });
    expect(repository.hydrate.mock.calls[0][1].map((row: PlatformTemplateTarget) => row.id)).toEqual(["older"]);
    expect(await read(2, 1)).toMatchObject({ total: 2, records: [{ id: "newer" }] });
  });
  it("does not load a denied row and counts only allowed records", async () => {
    denied.add(platformTemplateArn("remote-terminal", "older"));
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ id: "newer" }] });
    expect(repository.hydrate.mock.calls[0][1]).toEqual([rows[0]]);
    expect(iam.authorizeMany.mock.calls[0][0]).toMatchObject({
      action: "quyan:remote_terminal:ListTemplates",
      context: { "acs:SourceIp": "192.0.2.10" },
    });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("traverses all metadata batches and paginates after filtering", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 3 }, (_, index) =>
      target("template-" + index, index),
    );
    denied.add(platformTemplateArn("remote-terminal", rows[0]!.id));
    const result = await read(6, 100);
    expect(result.total).toBe(rows.length - 1);
    expect(result.records).toHaveLength(2);
    expect(repository.hydrate.mock.calls[0][1]).toHaveLength(2);
    expect(repository.scan).toHaveBeenCalledTimes(4);
  });
  it("requires the global group ceiling before scanning", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("no platform group"));
    await expect(read()).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects a credential or group change before returning hydrated records", async () => {
    repository.hydrate.mockImplementationOnce(async () => {
      snapshots.recheck.mockRejectedValue(new Error("revoked"));
      return [{ id: "older" }, { id: "newer" }];
    });
    await expect(read()).rejects.toThrow("revoked");
  });
  it("rejects policy changes during hydration", async () => {
    repository.hydrate.mockImplementationOnce(async () => {
      iam.loadPolicies.mockResolvedValue([
        { policyId: "changed", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
      ]);
      return [{ id: "older" }, { id: "newer" }];
    });
    await expect(read()).rejects.toThrow();
  });
  it("rejects source content changes even when updateTime is unchanged", async () => {
    repository.hydrate.mockImplementationOnce(async () => {
      rows = rows.map((row) => ({ ...row, revision: "b".repeat(64) }));
      return [{ id: "older" }, { id: "newer" }];
    });
    await expect(read()).rejects.toThrow();
  });
  it("rejects incomplete, substituted or reordered hydration", async () => {
    repository.hydrate.mockResolvedValue([{ id: "wrong" }]);
    await expect(read()).rejects.toThrow();
  });
  it("returns an empty authorized page without a fallback global read", async () => {
    rows.forEach((row) => denied.add(platformTemplateArn("remote-terminal", row.id)));
    expect(await read()).toMatchObject({ total: 0, records: [] });
    expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), []);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("preserves %s enforcement while shadow fails", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    expect(await read()).toMatchObject({ total: 7, records: [{ id: "legacy" }] });
    expect(permissions.checkUserPermissions).toHaveBeenCalled();
  });
  it("never calls legacy after native failure in enforce", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1.5, pageSize: 20 },
    { page: 1, pageSize: 101 },
  ])("rejects invalid pagination %j", async ({ page, pageSize }) => {
    await expect(read(page, pageSize)).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
});

const readOptions = (page = 1, pageSize = 20) => service.listOptions(request(), { page, pageSize }, "fixture", legacy);
describe("terminal template option admission", () => {
  it("declares a real collection route and all former ANY aliases", () => {
    const definition = IAM_REMOTE_TERMINAL_TEMPLATE_OPTIONS_DEFINITION;
    expect(getIamActionDefinition(definition.action)).toMatchObject({
      resourceTypes: ["platform/remote-terminal-template"],
      authorizationBoundary: "platform",
      legacyPermissions: definition.legacyPermissions,
    });
    for (const permission of definition.legacyPermissions)
      expect(iamActionsForLegacyPermission(permission)).toContain(definition.action);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.key === definition.route),
    ).toMatchObject({
      coverage: "explicit",
      actions: [definition.action],
      resourceKind: "collection",
      issues: [],
    });
  });
  it("hydrates only permitted names using the dedicated action, not full template content", async () => {
    denied.add(platformTemplateArn("remote-terminal", "older"));
    expect(await readOptions(1, 1)).toMatchObject({ total: 1, records: [{ id: "newer", name: "newer" }] });
    expect(repository.where).toHaveBeenCalledWith({ keyword: "fixture", order: "name" });
    expect(iam.authorizeMany.mock.calls[0][0].action).toBe("quyan:remote_terminal:ListTemplateOptions");
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(optionsRepository.hydrateOptions.mock.calls[0][1]).toEqual([rows[0]]);
    expect(snapshots.snapshot.mock.calls[0][1]).toEqual(
      IAM_REMOTE_TERMINAL_TEMPLATE_OPTIONS_DEFINITION.legacyPermissions,
    );
  });
  it("counts and selects after scanning multiple metadata pages", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 7 }, (_, index) =>
      target("template" + index, index),
    );
    expect(await readOptions(2, 100)).toMatchObject({ total: rows.length });
    expect(optionsRepository.hydrateOptions.mock.calls[0][1]).toEqual(rows.slice(100, 200));
    expect(repository.scan.mock.calls.length).toBeGreaterThan(2);
  });
  it.each(["legacy", "shadow"] as const)("preserves %s ANY aliases including assignment-only access", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockImplementation(async (_user, [permission]) => ({
      hasPermission: permission === Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
    }));
    expect(await readOptions()).toMatchObject({ total: 7 });
    expect(permissions.checkUserPermissions).toHaveBeenCalledTimes(2);
  });
  it("refuses the legacy read when no former ANY alias is present", async () => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(readOptions()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("refuses source changes after option hydration", async () => {
    optionsRepository.hydrateOptions.mockImplementationOnce(async (_principal, targets) => {
      rows = rows.map((row) => ({ ...row, revision: "b".repeat(64) }));
      return targets.map((row: PlatformTemplateTarget) => ({
        id: row.id,
        name: row.id,
        status: 1,
        publishStatus: "draft",
      }));
    });
    await expect(readOptions()).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("refuses policy revocation after option hydration", async () => {
    optionsRepository.hydrateOptions.mockImplementationOnce(async () => {
      iam.loadPolicies.mockResolvedValue([
        { policyId: "revoked", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
      ]);
      return [{ id: "older" }, { id: "newer" }];
    });
    await expect(readOptions()).rejects.toThrow();
  });
  it("fails closed without falling back to the global option read", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("unavailable"));
    await expect(readOptions()).rejects.toThrow("unavailable");
    expect(legacy).not.toHaveBeenCalled();
    expect(optionsRepository.hydrateOptions).not.toHaveBeenCalled();
  });
});
