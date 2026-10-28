import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/store/system/content-safety-system-incident.repository", () => ({
  ContentSafetySystemIncidentRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: () => ({}) },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { ContentSafetySystemIncidentIamService } from "@/services/system/content-safety-system-incident-iam.service";
import { contentSafetySystemIncidentArn } from "@/iam/resources/content-safety-system-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { ContentSafetySystemIncidentTarget } from "@/store/system/content-safety-system-incident.store";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  service = new ContentSafetySystemIncidentIamService(iam, snapshots, repository, permissions),
  mode = env.security.iamAuthorizationMode,
  legacy = vi.fn();
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    ip: "192.0.2.20",
    secure: true,
  }) as unknown as TypedRequest;
const targets = () =>
  [
    { id: "a", createTime: new Date(3000), sortRank: 3 },
    { id: "b", createTime: new Date(2000), sortRank: 1 },
    { id: "c", createTime: new Date(1000), sortRank: 2 },
  ].map((row) => ({
    ...row,
    status: 1,
    updateTime: new Date(4000),
    revision: "a".repeat(64),
    ruleId: "rule",
    ruleOwnerUserId: null,
    ruleStatus: 1,
  }));
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
  repository.where.mockResolvedValue({ predicate: {}, ordering: {} });
  repository.scan.mockResolvedValue(targets());
  repository.hydrate.mockImplementation(async (_where, rows: ContentSafetySystemIncidentTarget[], rules: Set<string>) =>
    rows.map((row) => ({
      id: row.id,
      matchContext: "private-incident-body",
      rule: { name: "Rule", type: "literal", ...(rules.has("rule") ? { pattern: "private-rule-pattern" } : {}) },
    })),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ incidents: [], total: 0 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("system content safety incident reads", () => {
  it("sorts and paginates only admitted metadata before body hydration", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemIncidentArn("b") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    const first = await service.list({ page: 1, pageSize: 1 }, request(), legacy);
    expect(first.total).toBe(2);
    expect(first.incidents.map((row: any) => row.id)).toEqual(["c"]);
    expect(repository.hydrate.mock.calls[0]![1].map((row: any) => row.id)).toEqual(["c"]);
    expect(
      (await service.list({ page: 2, pageSize: 1 }, request(), legacy)).incidents.map((row: any) => row.id),
    ).toEqual(["a"]);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("returns no content or count when there is no matching Allow", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await service.list({}, request(), legacy)).toEqual({ incidents: [], total: 0 });
    expect(repository.hydrate.mock.calls[0]![1]).toEqual([]);
  });
  it("does not read live rule patterns through an allowed incident", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action === "quyan:content_safety:ListSystemRules" ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    const result = await service.list({}, request(), legacy);
    expect(result.total).toBe(3);
    expect(result.incidents.every((row: any) => !row.rule.pattern)).toBe(true);
    expect(repository.hydrate.mock.calls[0]![2].size).toBe(0);
  });
  it("never selects private or inactive associated rule bodies", async () => {
    repository.scan.mockResolvedValue(
      targets().map((row, index) => ({
        ...row,
        ruleOwnerUserId: index ? null : "private-owner",
        ruleStatus: index ? 0 : 1,
      })),
    );
    await service.list({}, request(), legacy);
    expect(repository.hydrate.mock.calls[0]![2].size).toBe(0);
  });
  it("rejects a changed rule read decision before returning a hydrated pattern", async () => {
    let calls = 0;
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action === "quyan:content_safety:ListSystemRules" && ++calls > 1 ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(service.list({}, request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks rule conditions after a long final incident scan", async () => {
    let scans = 0;
    repository.scan.mockImplementation(async () => {
      if (++scans > 1)
        iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
          resources.map(() => ({
            decision: action === "quyan:content_safety:ListSystemRules" ? "ExplicitDeny" : "Allow",
            reason: "fixture",
            matchedStatements: [],
          })),
        );
      return targets();
    });
    await expect(service.list({}, request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed incident content in the final scan", async () => {
    repository.hydrate.mockImplementation(async () => {
      repository.scan.mockResolvedValue(targets().map((row) => ({ ...row, revision: "b".repeat(64) })));
      return [];
    });
    await expect(service.list({}, request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps forensic content out of authorization audit events", async () => {
    await service.list({}, request(), legacy);
    const audit = JSON.stringify(vi.mocked(auditIamDecision).mock.calls);
    expect(audit).not.toContain("private-incident-body");
    expect(audit).not.toContain("private-rule-pattern");
    expect(audit).not.toContain("jwt");
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { page: 1.5 }])("rejects invalid pagination %j", async (query) => {
    await expect(service.list(query, request(), legacy)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "delegated", "invalid-mode"])("rejects %s identity context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.user;
    if (kind === "oauth") req.oauthAccessToken = {} as any;
    if (kind === "delegated") req.authContext!.principalUserId = "owner";
    if (kind === "invalid-mode") env.security.iamAuthorizationMode = "invalid" as any;
    await expect(service.list({}, req, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains the old result in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    expect(await service.list({}, request(), legacy)).toEqual({ incidents: [], total: 0 });
    expect(legacy).toHaveBeenCalledOnce();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list({}, request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("declares a fixed collection action on the system endpoint", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/system/content-safety.controller.ts");
    expect(collectIamRoutes([source], process.cwd()).find((row) => row.method === "listIncidents")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:content_safety:ListSystemIncidents"],
      resourceKind: "collection",
      issues: [],
    });
  });
});
