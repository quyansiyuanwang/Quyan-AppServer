import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/content-safety-system-read.repository", () => ({
  ContentSafetySystemReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
import { env } from "@/config/env";
import { ContentSafetySystemReadIamService } from "@/services/system/content-safety-system-read-iam.service";
import {
  contentSafetySystemConfigArn,
  contentSafetySystemRuleArn,
} from "@/iam/resources/content-safety-system-resources";
import type { ContentSafetySystemRuleTarget } from "@/store/system/content-safety-system-read.store";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn(), configuration: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  service = new ContentSafetySystemReadIamService(iam, snapshots, repository, permissions),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const targets = () =>
  [
    { id: "c", priority: 9, createTime: new Date(3000) },
    { id: "b", priority: 1, createTime: new Date(2000) },
    { id: "a", priority: 1, createTime: new Date(1000) },
  ].map((row) => ({ ...row, status: 1, updateTime: new Date(4000), revision: "a".repeat(64) }));
const legacy = vi.fn();
const publicConfig = async (values: Record<string, string>) => ({ aiApiKeyConfigured: Boolean(values.secret) });
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  repository.where.mockResolvedValue(true);
  repository.scan.mockResolvedValue(targets());
  repository.hydrate.mockImplementation(async (rows: ContentSafetySystemRuleTarget[]) =>
    rows.map((row) => ({
      ...row,
      name: row.id,
      pattern: "pattern-" + row.id,
      type: "keyword",
      direction: "both",
      action: "allow",
      enabled: true,
      source: "custom",
      ownerUserId: null,
      version: null,
    })),
  );
  repository.configuration.mockResolvedValue({
    values: { secret: "fixture-only-encrypted-marker" },
    revision: "b".repeat(64),
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ rules: [], total: 0 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("system content safety resource reads", () => {
  it("authorizes the fixed config ARN before fetching its values", async () => {
    expect(await service.config(request(), legacy, publicConfig)).toEqual({ aiApiKeyConfigured: true });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:content_safety:GetSystemConfig",
        resources: [contentSafetySystemConfigArn()],
      }),
    );
    expect(legacy).not.toHaveBeenCalled();
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ExplicitDeny", reason: "denied", matchedStatements: [] })),
    );
    repository.configuration.mockClear();
    await expect(service.config(request(), legacy, publicConfig)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.configuration).not.toHaveBeenCalled();
  });
  it("paginates and counts only allowed rules in priority order", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemRuleArn("b") ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    const result = await service.list(request(), 1, 1, legacy);
    expect(result.total).toBe(2);
    expect(result.rules.map((rule) => rule.id)).toEqual(["a"]);
    expect(repository.hydrate.mock.calls[0]![0].map((row: ContentSafetySystemRuleTarget) => row.id)).toEqual(["a"]);
    expect((await service.list(request(), 2, 1, legacy)).rules.map((rule) => rule.id)).toEqual(["c"]);
  });
  it("returns a genuinely empty list when no rule matches Allow", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "test", matchedStatements: [] })),
    );
    expect(await service.list(request(), 1, 10, legacy)).toEqual({ rules: [], total: 0 });
    expect(repository.hydrate).toHaveBeenCalledWith([]);
  });
  it("does not fetch or count a denied rule's content", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemRuleArn("c") ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    const result = await service.export(
      request(),
      "csv",
      async () => ({ format: "csv", filename: "legacy", content: "legacy" }),
      publicConfig,
    );
    expect(result.content).toContain("pattern-a");
    expect(result.content).not.toContain("pattern-c");
    expect(
      repository.hydrate.mock.calls.flatMap((call) => call[0].map((row: ContentSafetySystemRuleTarget) => row.id)),
    ).not.toContain("c");
    expect(repository.configuration).not.toHaveBeenCalled();
  });
  it("requires independent config authority only for JSON export", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action.endsWith("GetSystemConfig") ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    const fallback = async () => ({ format: "json" as const, filename: "legacy", content: "legacy" });
    await expect(service.export(request(), "json", fallback, publicConfig)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect((await service.export(request(), "csv", fallback, publicConfig)).format).toBe("csv");
  });
  it("renders only sanitized JSON config and selected rule fields", async () => {
    const result = await service.export(
      request(),
      "json",
      async () => ({ format: "json", filename: "legacy", content: "legacy" }),
      publicConfig,
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.config).toEqual({ aiApiKeyConfigured: true });
    expect(result.content).not.toContain("fixture-only-encrypted-marker");
    expect(parsed.rules[0]).not.toHaveProperty("revision");
    expect(parsed.rules.map((rule: { id: string }) => rule.id)).toEqual(["a", "b", "c"]);
  });
  it("rejects a raw-content revision change during hydration", async () => {
    let changed = false;
    repository.hydrate.mockImplementation(async () => {
      changed = true;
      return [];
    });
    repository.scan.mockImplementation(async () =>
      targets().map((row) => ({ ...row, revision: changed ? "c".repeat(64) : row.revision })),
    );
    await expect(service.list(request(), 1, 10, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps config source validation around the final rule rescan", async () => {
    const source = { values: { secret: "fixture-marker" }, revision: "b".repeat(64) };
    repository.configuration.mockImplementation(async () => ({ ...source }));
    let scans = 0;
    repository.scan.mockImplementation(async () => {
      if (++scans === 2) source.revision = "c".repeat(64);
      return targets();
    });
    await expect(
      service.export(
        request(),
        "json",
        async () => ({ format: "json", filename: "legacy", content: "legacy" }),
        publicConfig,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks grant fingerprints before returning rules", async () => {
    repository.hydrate.mockImplementation(async () => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: [{ Effect: "Allow", Action: ["quyan:content_safety:GetSystemConfig"], Resource: ["*"] }],
          },
        },
      ]);
      return [];
    });
    await expect(service.list(request(), 1, 10, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails on an incomplete batch decision", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request(), 1, 10, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["missing", "different-principal", "oauth", "mode"])("fails closed for %s context", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "different-principal") req.authContext!.principalUserId = "other";
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "mode") env.security.iamAuthorizationMode = "unknown" as never;
    await expect(service.list(req, 1, 10, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each([
    [0, 10],
    [1, 101],
    [1.5, 10],
    [10001, 10],
  ])("validates page %s size %s", async (page, size) => {
    await expect(service.list(request(), page, size, legacy)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy enforcement in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ExplicitDeny", reason: "test", matchedStatements: [] })),
    );
    expect(await service.list(request(), 1, 10, legacy)).toEqual({ rules: [], total: 0 });
    expect(legacy).toHaveBeenCalledOnce();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list(request(), 1, 10, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("registers all three read endpoints and retains export body validation", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      file = project.addSourceFileAtPath("src/api/controllers/v1/system/content-safety.controller.ts");
    const rows = collectIamRoutes([file], process.cwd());
    for (const [method, action] of [
      ["getConfig", "GetSystemConfig"],
      ["listRules", "ListSystemRules"],
      ["exportRules", "ExportSystemRules"],
    ])
      expect(rows.find((row) => row.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:content_safety:" + action],
        issues: [],
      });
    expect(file.getClassOrThrow("ContentSafetyController").getMethodOrThrow("exportRules").getText()).toContain(
      "validateBody(contentSafetyExportSchema)",
    );
  });
});
