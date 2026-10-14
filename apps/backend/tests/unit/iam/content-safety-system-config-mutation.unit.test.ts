import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/store/system/content-safety-system-config-mutation.repository", () => ({
  ContentSafetySystemConfigMutationRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: () => ({}) },
}));
import { env } from "@/config/env";
import { ContentSafetySystemConfigMutationIamService } from "@/services/system/content-safety-system-config-mutation-iam.service";
import { contentSafetySystemConfigArn } from "@/iam/resources/content-safety-system-resources";
import type { TypedRequest } from "@/types/express";
import type { ContentSafetySystemConfigMutationGuard } from "@/store/system/content-safety-system-config-mutation.store";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { configuration: vi.fn(), authorizationRevision: vi.fn(), update: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  service = new ContentSafetySystemConfigMutationIamService(iam, snapshots, repository, permissions),
  mode = env.security.iamAuthorizationMode,
  updates = vi.fn(),
  legacy = vi.fn(),
  view = vi.fn();
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
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
  repository.configuration.mockResolvedValue({ values: {}, revision: "a".repeat(64) });
  repository.authorizationRevision.mockResolvedValue("revision");
  repository.update.mockImplementation(async (_updates, guard: ContentSafetySystemConfigMutationGuard) => {
    await guard.users.recheck();
    return { values: { updated: "true" }, revision: "b".repeat(64) };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  updates.mockReturnValue({ key: "value" });
  legacy.mockResolvedValue({ legacy: true });
  view.mockResolvedValue({ updated: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("system content safety configuration mutation", () => {
  it("uses a fixed action and server resource before reading or preparing config", async () => {
    expect(await service.update(request(), "actor", updates, legacy, view)).toEqual({ updated: true });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:content_safety:UpdateSystemConfig",
        resources: [contentSafetySystemConfigArn()],
        principal: expect.objectContaining({ accountOwnerId: "owner" }),
      }),
    );
    expect(iam.authorizeMany.mock.invocationCallOrder[0]).toBeLessThan(
      repository.configuration.mock.invocationCallOrder[0]!,
    );
    expect(repository.update).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalledWith({ updated: "true" });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("rejects %s before reading or preparing values", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ decision, reason: "denied", matchedStatements: [] }]);
    await expect(service.update(request(), "actor", updates, legacy, view)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.configuration).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["missing", "wrong-actor", "oauth", "delegated", "readonly", "invalid-mode"])(
    "fails closed for %s",
    async (scenario) => {
      const req = request();
      let actor = "actor";
      if (scenario === "missing") delete req.user;
      if (scenario === "wrong-actor") actor = "someone";
      if (scenario === "oauth") req.oauthAccessToken = {} as any;
      if (scenario === "delegated") req.authContext!.principalUserId = "owner";
      if (scenario === "readonly") req.user = { ...req.user!, impersonatorId: "owner", impersonationMode: "view" };
      if (scenario === "invalid-mode") env.security.iamAuthorizationMode = "invalid" as any;
      await expect(service.update(req, actor, updates, legacy, view)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.update).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it("does not persist a partially prepared invalid config", async () => {
    updates.mockImplementation(() => {
      throw new Error("invalid config");
    });
    await expect(service.update(request(), "actor", updates, legacy, view)).rejects.toThrow("invalid config");
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["snapshot", "policies", "authorization"])("rechecks %s at the write boundary", async (kind) => {
    repository.update.mockImplementation(async (_updates, guard: ContentSafetySystemConfigMutationGuard) => {
      if (kind === "snapshot") snapshots.recheck.mockRejectedValue(new Error("changed"));
      if (kind === "policies")
        iam.loadPolicies.mockResolvedValue([
          {
            policyId: "changed",
            document: { Version: "1", Statement: [{ Effect: "Deny", Action: ["*"], Resource: ["*"] }] },
          },
        ]);
      if (kind === "authorization") repository.authorizationRevision.mockResolvedValue("changed");
      await guard.users.recheck();
      return { values: {}, revision: "" };
    });
    await expect(service.update(request(), "actor", updates, legacy, view)).rejects.toThrow();
    expect(view).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("executes only one old write in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    expect(await service.update(request(), "actor", updates, legacy, view)).toEqual({ legacy: true });
    expect(legacy).toHaveBeenCalledOnce();
    expect(repository.update).not.toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.update(request(), "actor", updates, legacy, view)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains the old result when shadow IAM denies", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.authorizeMany.mockResolvedValue([
      { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] },
    ]);
    expect(await service.update(request(), "actor", updates, legacy, view)).toEqual({ legacy: true });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("declares the resource and keeps step-up replay and input validation", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/system/content-safety.controller.ts");
    const route = collectIamRoutes([source], process.cwd()).find((row) => row.method === "updateConfig");
    expect(route).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:content_safety:UpdateSystemConfig"],
      resourceKind: "single-resource",
      issues: [],
    });
    const method = source.getClassOrThrow("ContentSafetyController").getMethodOrThrow("updateConfig").getFullText();
    expect(method).toContain("twoFactorChallengeMiddleware");
    expect(method).toContain("replayProtectionMiddleware");
    expect(method).toContain("validateBody(contentSafetyConfigSchema)");
  });
});
