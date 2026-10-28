import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-lifecycle-history.repository", () => ({
  PlatformLifecycleHistoryRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
import { PlatformLifecycleDownloadIamService } from "@/services/system/platform-lifecycle-download-iam.service";
import { platformLifecycleArtifactArn } from "@/iam/resources/platform-lifecycle-resources";
import { platformLifecycleArtifactResourceResolver } from "@/iam/request/platform-lifecycle-resource-resolvers";
import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const run = { id: "run", status: 1, dataset: "api_logs", createTime: new Date(0), updateTime: new Date(0) };
const target = { ...run, id: "file", lifecycleRunId: run.id, lifecycleRun: run };
let service: PlatformLifecycleDownloadIamService, iam: any, repo: any, snapshots: any, request: TypedRequest<any>;
beforeEach(() => {
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global" }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repo = {
    targetDownload: vi.fn().mockResolvedValue(target),
    hydrateArtifacts: vi
      .fn()
      .mockResolvedValue([
        { ...target, objectKey: "fixture.ndjson.gz", deletedAt: null, expiresAt: null, byteSize: 5n },
      ]),
  };
  service = new (PlatformLifecycleDownloadIamService as any)(iam, snapshots, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { artifactId: "file", runId: "fake-parent" },
    body: { objectKey: "fake" },
  } as unknown as TypedRequest<any>;
});
describe("archive download resource authorization", () => {
  it("declares an independent download action and retains replay and 2FA", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true }),
      file = p.addSourceFileAtPath("src/api/controllers/v1/system/data-lifecycle.controller.ts");
    expect(getIamActionDefinition("quyan:system:data_lifecycle:DownloadArtifact")).toMatchObject({
      accessLevel: "Read",
      sensitive: true,
      authorizationBoundary: "platform",
      resourceTypes: ["platform/lifecycle-artifact"],
    });
    expect(
      collectIamRoutes(p.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "POST /v1/data-lifecycle/artifacts/{artifactId}/download",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:system:data_lifecycle:DownloadArtifact"], issues: [] });
    const method = file.getClassOrThrow("DataLifecycleController").getMethodOrThrow("download").getText();
    for (const guard of [
      "ReplayProtected",
      "TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "twoFactorChallengeMiddleware",
    ])
      expect(method).toContain(guard);
  });
  it("uses only the stored parent relationship, not client resource metadata", async () => {
    vi.mocked(PlatformLifecycleHistoryRepository.getInstance).mockReturnValue(repo);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLifecycleArtifactResourceResolver({ request, principal })).toBe(
      platformLifecycleArtifactArn(run.id, target.id),
    );
    repo.targetDownload.mockResolvedValue(null);
    expect(await platformLifecycleArtifactResourceResolver({ request, principal })).toBeUndefined();
    request.params.artifactId = "../foreign";
    expect(await platformLifecycleArtifactResourceResolver({ request, principal })).toBeUndefined();
  });
  it("hydrates only after authorization and exposes a pinned artifact with a reusable recheck", async () => {
    const guard = (await service.prepare(target.id, request))!;
    expect(guard.artifact.objectKey).toBe("fixture.ndjson.gz");
    expect(Object.isFrozen(guard.artifact)).toBe(true);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:system:data_lifecycle:DownloadArtifact",
        resource: platformLifecycleArtifactArn(run.id, target.id),
      }),
    );
    iam.authorize.mockResolvedValue(deny);
    await expect(guard.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never hydrates keys on Deny or missing/invalid ancestry", async () => {
    iam.authorize.mockResolvedValue(deny);
    await expect(service.prepare(target.id, request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorize.mockResolvedValue(allow);
    repo.targetDownload.mockResolvedValue({ ...target, lifecycleRunId: "other-run" });
    await expect(service.prepare(target.id, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrateArtifacts).not.toHaveBeenCalled();
  });
  it("rejects deleted, expired or unsafe object metadata before returning a guard", async () => {
    for (const patch of [
      { deletedAt: new Date() },
      { expiresAt: new Date(0) },
      { objectKey: "bad\nkey" },
      { objectKey: "" },
    ]) {
      repo.hydrateArtifacts.mockResolvedValue([
        { ...target, objectKey: "fixture", deletedAt: null, expiresAt: null, ...patch },
      ]);
      await expect(service.prepare(target.id, request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("checks both file and parent versions and rejects revoked platform snapshots", async () => {
    const guard = (await service.prepare(target.id, request))!;
    repo.targetDownload.mockResolvedValue({ ...target, lifecycleRun: { ...run, updateTime: new Date(1) } });
    await expect(guard.recheck()).rejects.toMatchObject({ statusCode: 403 });
    repo.targetDownload.mockResolvedValue(target);
    snapshots.recheck.mockRejectedValue(new Error("revoked"));
    await expect(guard.recheck()).rejects.toThrow("revoked");
  });
  it("shadow is metadata only, and missing context or OAuth cannot reach object storage metadata", async () => {
    expect(await service.prepare(target.id, request, false)).toBeUndefined();
    expect(repo.hydrateArtifacts).not.toHaveBeenCalled();
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.prepare(target.id, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare(target.id)).rejects.toMatchObject({ statusCode: 403 });
  });
});
