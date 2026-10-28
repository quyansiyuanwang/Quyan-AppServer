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
import { getIamActionDefinition, getIamResourceType } from "@quyan/shared";
import { PlatformLifecycleHistoryIamService } from "@/services/system/platform-lifecycle-history-iam.service";
import { platformLifecycleRunArn, platformLifecycleArtifactArn } from "@/iam/resources/platform-lifecycle-resources";
import { platformLifecycleRunResourceResolver } from "@/iam/request/platform-lifecycle-resource-resolvers";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const run = { id: "run-a", status: 1, dataset: "api_logs", createTime: new Date(0), updateTime: new Date(0) };
const artifact = { ...run, id: "artifact-a", lifecycleRunId: run.id };
let service: PlatformLifecycleHistoryIamService, iam: any, snapshots: any, repo: any, request: TypedRequest<any>;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global" }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repo = {
    scanRuns: vi.fn().mockResolvedValue([run]),
    targetRun: vi.fn().mockResolvedValue(run),
    checkRuns: vi.fn().mockImplementation(async (_p: any, rows: any[]) => rows),
    hydrateRuns: vi.fn().mockImplementation(async (_p: any, rows: any[]) => rows),
    scanArtifacts: vi.fn().mockResolvedValue([artifact]),
    checkArtifacts: vi.fn().mockImplementation(async (_p: any, _r: any, rows: any[]) => rows),
    hydrateArtifacts: vi
      .fn()
      .mockImplementation(async (_p: any, _r: any, rows: any[]) =>
        rows.map((t: any) => ({ ...t, objectKey: "fixture.ndjson.gz", byteSize: 5n })),
      ),
  };
  service = new (PlatformLifecycleHistoryIamService as any)(iam, snapshots, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { runId: run.id },
  } as unknown as TypedRequest<any>;
});
describe("lifecycle run and archive collection authorization", () => {
  it("declares independent actions, canonical parented files and explicit routes", async () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    p.addSourceFileAtPath("src/api/controllers/v1/system/data-lifecycle.controller.ts");
    const routes = collectIamRoutes(p.getSourceFiles(), process.cwd());
    for (const [key, operation] of [
      ["GET /v1/data-lifecycle/runs", "ListRuns"],
      ["GET /v1/data-lifecycle/runs/{runId}/artifacts", "ListArtifacts"],
    ]) {
      const action = "quyan:system:data_lifecycle:" + operation;
      expect(routes.find((r) => r.key === key)).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
      expect(getIamActionDefinition(action)).toMatchObject({ authorizationBoundary: "platform", accessLevel: "List" });
    }
    expect(getIamResourceType(platformLifecycleArtifactArn(run.id, artifact.id))).toMatchObject({
      id: "platform/lifecycle-artifact",
      identifierSegments: 2,
    });
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLifecycleRunResourceResolver({ request, principal })).toBe(platformLifecycleRunArn(run.id));
    request.params.runId = "../foreign";
    expect(await platformLifecycleRunResourceResolver({ request, principal })).toBeUndefined();
  });
  it("filters runs before total, pagination and display hydration", async () => {
    const hidden = { ...run, id: "run-b" };
    repo.scanRuns.mockResolvedValue([run, hidden]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r === platformLifecycleRunArn(hidden.id) ? deny : allow)),
    );
    const result = await service.listRuns(1, 1, request);
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(run.id);
    expect(repo.hydrateRuns).toHaveBeenCalledWith(expect.anything(), [run]);
    expect(result.items[0]._count.artifacts).toBe(1);
  });
  it("counts only visible files and never scans children of a denied parent", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }: any) =>
      resources.map(() => (action.endsWith(":ListArtifacts") ? deny : allow)),
    );
    const result = await service.listRuns(1, 20, request);
    expect(result.items[0]._count.artifacts).toBe(0);
    expect(repo.scanArtifacts).not.toHaveBeenCalled();
    await expect(service.listArtifacts(run.id, 1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrateArtifacts).not.toHaveBeenCalled();
  });
  it("filters individual files before hydration, pagination and totals", async () => {
    const hidden = { ...artifact, id: "artifact-b" };
    repo.scanArtifacts.mockResolvedValue([artifact, hidden]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r === platformLifecycleArtifactArn(run.id, hidden.id) ? deny : allow)),
    );
    const result = await service.listArtifacts(run.id, 1, 1, request);
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(artifact.id);
    expect(repo.hydrateArtifacts).toHaveBeenCalledWith(expect.anything(), run, [artifact]);
  });
  it("rejects malformed batches, wrong file ancestry, missing decisions and invalid pagination", async () => {
    repo.scanArtifacts.mockResolvedValue([{ ...artifact, lifecycleRunId: "other-run" }]);
    await expect(service.listArtifacts(run.id, 1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
    repo.scanRuns.mockResolvedValue([run, run]);
    await expect(service.listRuns(1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
    repo.scanRuns.mockResolvedValue([run]);
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.listRuns(1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listRuns(0, 20, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.hydrateRuns).not.toHaveBeenCalled();
  });
  it("checks totals beyond the selected page and rejects changed versions after display loads", async () => {
    const other = { ...run, id: "run-b" };
    repo.scanRuns.mockResolvedValue([run, other]);
    repo.hydrateRuns.mockImplementation(async (_p: any, rows: any) => {
      repo.checkRuns.mockResolvedValue([run]);
      return rows;
    });
    await expect(service.listRuns(1, 1, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects final child Deny after loading file metadata", async () => {
    repo.hydrateArtifacts.mockImplementation(async (_p: any, _r: any, rows: any) => {
      iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
        resources.map((r: string) => (r === platformLifecycleArtifactArn(run.id, artifact.id) ? deny : allow)),
      );
      return rows;
    });
    await expect(service.listArtifacts(run.id, 1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on missing identity, OAuth, revoked snapshots and shadow never reads display fields", async () => {
    await expect(service.listRuns(1, 20)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.listRuns(1, 20, request)).rejects.toMatchObject({ statusCode: 403 });
    delete request.oauthAccessToken;
    expect(await service.listArtifacts(run.id, 1, 20, request, false)).toEqual({ items: [], total: 1 });
    expect(repo.hydrateArtifacts).not.toHaveBeenCalled();
    snapshots.recheck.mockRejectedValue(new Error("revoked"));
    await expect(service.listRuns(1, 20, request)).rejects.toThrow("revoked");
  });
});
