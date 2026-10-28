import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/content-safety-system-rule-mutation.repository", () => ({
  ContentSafetySystemRuleMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
import { env } from "@/config/env";
import { ContentSafetySystemRuleMutationIamService } from "@/services/system/content-safety-system-rule-mutation-iam.service";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
} from "@/iam/resources/content-safety-system-resources";
import { contentSafetySystemRuleBatchResourceResolver } from "@/iam/request/content-safety-system-resource-resolvers";
import type { ContentSafetySystemRuleMutationGuard } from "@/store/system/content-safety-system-rule-mutation.store";
import type { ContentSafetyRule } from "@prisma/client";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = {
    targets: vi.fn(),
    authorizationRevision: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batch: vi.fn(),
  },
  permissions = { checkUserPermissions: vi.fn() },
  service = new ContentSafetySystemRuleMutationIamService(iam, snapshots, repository, permissions),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const data = () => ({
  name: "Rule",
  type: "literal",
  pattern: "pattern",
  direction: "both",
  action: "allow",
  enabled: true,
  priority: 0,
});
const row = (id = "created") =>
  ({
    ...data(),
    id,
    ownerUserId: null,
    source: "custom",
    status: 1,
    version: null,
    createTime: new Date(0),
    updateTime: new Date(0),
  }) as ContentSafetyRule;
const legacy = vi.fn(),
  validate = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "allow", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  repository.targets.mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({
      id,
      status: 1,
      revision: "a".repeat(64),
      createTime: new Date(0),
      updateTime: new Date(0),
      priority: 0,
    })),
  );
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.create.mockImplementation(async (guard: ContentSafetySystemRuleMutationGuard) => {
    await guard.authorizeCreated("created");
    await guard.users.recheck();
    return row();
  });
  repository.update.mockImplementation(async (guard: ContentSafetySystemRuleMutationGuard) => {
    await guard.users.recheck();
    return row(guard.targets[0]!.id);
  });
  repository.remove.mockImplementation(async (guard: ContentSafetySystemRuleMutationGuard) => {
    await guard.users.recheck();
  });
  repository.batch.mockImplementation(async (guard: ContentSafetySystemRuleMutationGuard) => {
    await guard.users.recheck();
    return { updated: guard.targets.length };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue(row());
  validate.mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("system rule mutation authorization", () => {
  it("checks the server control boundary and real created resource", async () => {
    const result = await service.create(
      { ...data(), id: "forged", ownerUserId: "foreign", status: 0, source: "user" },
      request(),
      validate,
      legacy,
    );
    expect(result.id).toBe("created");
    expect(repository.create.mock.calls[0]![1]).toEqual(data());
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:content_safety:CreateSystemRule",
        resources: [contentSafetySystemRuleControlArn()],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:content_safety:CreateSystemRule",
        resources: [contentSafetySystemRuleArn("created")],
      }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["control", "generated"])("rejects a missing %s creation grant", async (boundary) => {
    const denied = boundary === "control" ? contentSafetySystemRuleControlArn() : contentSafetySystemRuleArn("created");
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === denied ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(service.create(data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
    if (boundary === "control") {
      expect(repository.create).not.toHaveBeenCalled();
      expect(validate).not.toHaveBeenCalled();
    }
  });
  it.each(["update", "remove"] as const)("checks the fixed %s action on the target", async (operation) => {
    if (operation === "update") await service.update("a", data(), request(), validate, legacy);
    else await service.remove("a", request(), async () => {});
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action:
          operation === "update" ? "quyan:content_safety:UpdateSystemRule" : "quyan:content_safety:DeleteSystemRule",
        resources: [contentSafetySystemRuleArn("a")],
      }),
    );
  });
  it("authorizes every batch ID before persisting any changes", async () => {
    expect(
      await service.batch({ ids: ["a", "b"], changes: { enabled: false } }, request(), async () => ({ updated: 2 })),
    ).toEqual({ updated: 2 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:content_safety:BatchUpdateSystemRules",
        resources: [contentSafetySystemRuleArn("a"), contentSafetySystemRuleArn("b")],
      }),
    );
    repository.batch.mockClear();
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === contentSafetySystemRuleArn("b") ? "ExplicitDeny" : "Allow",
        reason: "test",
        matchedStatements: [],
      })),
    );
    await expect(
      service.batch({ ids: ["a", "b"], changes: { enabled: false } }, request(), async () => ({ updated: 2 })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.batch).not.toHaveBeenCalled();
  });
  it("cannot edit a missing, private, or differently cased target", async () => {
    repository.targets.mockResolvedValue([]);
    await expect(service.update("a", data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
    repository.targets.mockResolvedValue([{ id: "A", status: 1, revision: "a".repeat(64) }]);
    await expect(service.update("a", data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects duplicate IDs instead of partially updating", async () => {
    await expect(
      service.batch({ ids: ["a", "a"], changes: { enabled: false } }, request(), async () => ({ updated: 2 })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.batch).not.toHaveBeenCalled();
  });
  it("rechecks policy revocation in the final write guard", async () => {
    repository.update.mockImplementation(async (guard) => {
      iam.authorizeMany.mockImplementation(async ({ resources }) =>
        resources.map(() => ({ decision: "ExplicitDeny", reason: "test", matchedStatements: [] })),
      );
      await guard.users.recheck();
      return row("a");
    });
    await expect(service.update("a", data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed authorization revisions at commit", async () => {
    repository.update.mockImplementation(async (guard) => {
      repository.authorizationRevision.mockResolvedValue("c".repeat(64));
      await guard.users.recheck();
      return row("a");
    });
    await expect(service.update("a", data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not accept a changing generated identity", async () => {
    repository.create.mockImplementation(async (guard) => {
      await guard.authorizeCreated("created");
      await guard.authorizeCreated("other");
      return row();
    });
    await expect(service.create(data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves semantic rule validation after authorization", async () => {
    validate.mockRejectedValue(new Error("unsafe regex"));
    await expect(service.create(data(), request(), validate, legacy)).rejects.toThrow("unsafe regex");
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "other-principal", "oauth", "readonly", "mode"])("fails closed for %s identity", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "other-principal") req.authContext!.principalUserId = "other";
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "readonly") req.user = { ...req.user!, impersonatorId: "admin", impersonationMode: "view" };
    if (kind === "mode") env.security.iamAuthorizationMode = "unknown" as never;
    await expect(service.create(data(), req, validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each([{ type: "keyword" }, { name: "" }, { pattern: "x" }, { priority: -1 }])(
    "rejects invalid rule fields %j",
    async (input) => {
      await expect(service.create({ ...data(), ...input }, request(), validate, legacy)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("keeps old checks and one mutation in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    await service.create(data(), request(), validate, legacy);
    expect(legacy).toHaveBeenCalledOnce();
    expect(repository.create).not.toHaveBeenCalled();
    if (next === "shadow")
      expect(iam.authorizeMany).toHaveBeenCalledWith(
        expect.objectContaining({ resources: [contentSafetySystemRuleArn("created")] }),
      );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.create(data(), request(), validate, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unresolved or repeated batch resolver IDs", () => {
    const principal = {
        subjectUserId: "actor",
        principalUserId: "actor",
        accountOwnerId: "owner",
        subjectType: "sub_user" as const,
      },
      req: TypedRequest<unknown> = request();
    req.body = { ids: ["a", "b"] };
    expect(contentSafetySystemRuleBatchResourceResolver({ request: req, principal })).toEqual([
      contentSafetySystemRuleArn("a"),
      contentSafetySystemRuleArn("b"),
    ]);
    req.body = { ids: ["a", "a"] };
    expect(contentSafetySystemRuleBatchResourceResolver({ request: req, principal })).toBeUndefined();
  });
  it("declares four fixed operations while retaining step-up and replay", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      file = project.addSourceFileAtPath("src/api/controllers/v1/system/content-safety.controller.ts"),
      rows = collectIamRoutes([file], process.cwd());
    for (const [method, operation] of [
      ["createRule", "CreateSystemRule"],
      ["updateRule", "UpdateSystemRule"],
      ["deleteRule", "DeleteSystemRule"],
      ["batchUpdateRules", "BatchUpdateSystemRules"],
    ]) {
      expect(rows.find((row) => row.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:content_safety:" + operation],
        issues: [],
      });
      const text = file.getClassOrThrow("ContentSafetyController").getMethodOrThrow(method!).getText();
      expect(text).toContain("twoFactorChallengeMiddleware");
      expect(text).toContain("replayProtectionMiddleware");
    }
  });
});
