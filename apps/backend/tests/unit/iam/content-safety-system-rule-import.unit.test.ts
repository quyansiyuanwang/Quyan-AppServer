import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/store/system/content-safety-system-rule-mutation.repository", () => ({
  ContentSafetySystemRuleMutationRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/system/content-safety-system-read.repository", () => ({
  ContentSafetySystemReadRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: () => ({}) },
}));
import { env } from "@/config/env";
import { ContentSafetySystemRuleImportIamService } from "@/services/system/content-safety-system-rule-import-iam.service";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
} from "@/iam/resources/content-safety-system-resources";
import type {
  ContentSafetySystemRuleImportGuard,
  ContentSafetySystemRuleImportOperation,
} from "@/store/system/content-safety-system-rule-mutation.store";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = {
    targets: vi.fn(),
    authorizationRevision: vi.fn(),
    collectionRevision: vi.fn(),
    defaultTargets: vi.fn(),
    applyImport: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batch: vi.fn(),
  },
  reads = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn(), configuration: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  service = new ContentSafetySystemRuleImportIamService(iam, snapshots, repository, reads, permissions),
  mode = env.security.iamAuthorizationMode,
  plan = vi.fn(),
  legacy = vi.fn();
const target = {
  id: "a",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  priority: 0,
  revision: "a".repeat(64),
};
const data = () => ({
  name: "Rule",
  type: "literal",
  pattern: "pattern",
  direction: "both",
  action: "allow",
  enabled: true,
  priority: 0,
});
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    ip: "192.0.2.20",
    secure: true,
  }) as unknown as TypedRequest;
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
  repository.collectionRevision.mockResolvedValue("b".repeat(64));
  repository.authorizationRevision.mockResolvedValue("revision");
  repository.targets.mockImplementation(async (ids) => ids.map((id: string) => ({ ...target, id })));
  repository.defaultTargets.mockResolvedValue([target]);
  reads.where.mockResolvedValue(true);
  reads.scan.mockResolvedValue([target]);
  reads.hydrate.mockImplementation(async (targets) =>
    targets.map((row: any) => ({ ...row, ...data(), source: "default", ownerUserId: null, version: null })),
  );
  plan.mockResolvedValue({
    operations: [{ operation: "create", data: data(), source: "csv" }],
    result: { imported: 1 },
    apply: true,
  });
  repository.applyImport.mockImplementation(
    async (guard: ContentSafetySystemRuleImportGuard, operations: ContentSafetySystemRuleImportOperation[]) => {
      await guard.users.recheck();
      for (const [index, item] of operations.entries())
        if (item.operation === "create") await guard.authorizeCreated("new-" + index);
      await guard.users.recheck();
    },
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ imported: 1 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("system content safety rule imports", () => {
  it("authorizes the control resource before source metadata and each true created ID", async () => {
    expect(await service.execute("ImportSystemRules", request(), plan, legacy)).toEqual({ imported: 1 });
    expect(iam.authorizeMany.mock.calls[0]![0]).toMatchObject({
      action: "quyan:content_safety:ImportSystemRules",
      resources: [contentSafetySystemRuleControlArn()],
    });
    expect(iam.authorizeMany.mock.invocationCallOrder[0]).toBeLessThan(
      repository.collectionRevision.mock.invocationCallOrder[0]!,
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [contentSafetySystemRuleArn("new-0")] }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("handles multiple creations with independent resource checks", async () => {
    plan.mockResolvedValue({
      operations: [
        { operation: "create", data: data(), source: "csv" },
        { operation: "create", data: data(), source: "csv" },
      ],
      result: { imported: 2 },
      apply: true,
    });
    expect(await service.execute("ImportSystemRules", request(), plan, legacy)).toEqual({ imported: 2 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [contentSafetySystemRuleArn("new-1")] }),
    );
  });
  it("does not hydrate a denied existing rule", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemRuleArn("a") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    reads.hydrate.mockClear();
    await service.execute("ImportSystemRules", request(), plan, legacy);
    expect(plan).toHaveBeenCalledWith([]);
    expect(reads.hydrate.mock.calls.every(([targets]) => targets.length === 0)).toBe(true);
  });
  it("rejects a denied default target before reading its content", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemRuleArn("a") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(
      service.execute("ImportDefaultSystemRules", request(), plan, legacy, ["pattern"]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(reads.hydrate).not.toHaveBeenCalled();
  });
  it("rejects generated-resource Deny at the transaction boundary", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource.includes("new-") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(service.execute("ImportSystemRules", request(), plan, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["preview", "errors"])("does not mutate a %s plan", async (kind) => {
    plan.mockResolvedValue({ operations: [], result: { errors: kind === "errors" ? ["invalid"] : [] }, apply: false });
    await service.execute("ImportSystemRules", request(), plan, legacy);
    expect(repository.applyImport).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects source changes during planning", async () => {
    plan.mockImplementation(async () => {
      repository.collectionRevision.mockResolvedValue("c".repeat(64));
      return { operations: [], result: {}, apply: false };
    });
    await expect(service.execute("ImportSystemRules", request(), plan, legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.applyImport).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "readonly", "invalid-mode"])("fails closed for %s", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.user;
    if (kind === "oauth") req.oauthAccessToken = {} as any;
    if (kind === "readonly") req.user = { ...req.user!, impersonatorId: "owner", impersonationMode: "view" };
    if (kind === "invalid-mode") env.security.iamAuthorizationMode = "invalid" as any;
    await expect(service.execute("ImportSystemRules", req, plan, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.applyImport).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("executes one old import in %s and observes actual IDs", async (next) => {
    env.security.iamAuthorizationMode = next;
    legacy.mockImplementation(async (onCreated) => {
      if (onCreated) await onCreated("real-legacy-id");
      return { imported: 1 };
    });
    await service.execute("ImportSystemRules", request(), plan, legacy);
    expect(legacy).toHaveBeenCalledOnce();
    expect(repository.applyImport).not.toHaveBeenCalled();
    if (next === "shadow")
      expect(iam.authorizeMany).toHaveBeenCalledWith(
        expect.objectContaining({ resources: [contentSafetySystemRuleArn("real-legacy-id")] }),
      );
  });
  it("declares both server actions and retains step-up replay and CSV validation", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/system/content-safety.controller.ts"),
      rows = collectIamRoutes([source], process.cwd());
    for (const [method, operation] of [
      ["importDefaults", "ImportDefaultSystemRules"],
      ["importCsv", "ImportSystemRules"],
    ]) {
      expect(rows.find((row) => row.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:content_safety:" + operation],
        resourceKind: "collection",
        issues: [],
      });
      const text = source.getClassOrThrow("ContentSafetyController").getMethodOrThrow(method).getFullText();
      expect(text).toContain("twoFactorChallengeMiddleware");
      expect(text).toContain("replayProtectionMiddleware");
      if (method === "importCsv") expect(text).toContain("validateBody(contentSafetyCsvImportSchema)");
    }
  });
});
