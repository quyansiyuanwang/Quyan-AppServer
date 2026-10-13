import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-lifecycle-execution.repository", () => ({
  PlatformLifecycleExecutionRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformLifecycleExecutionIamService } from "@/services/system/platform-lifecycle-execution-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const run = "quyan:system:data_lifecycle:RunPolicy",
  batch = "quyan:system:data_lifecycle:RunBatch";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let iam: any, snapshots: any, repo: any, service: PlatformLifecycleExecutionIamService, request: TypedRequest;
const policy = (dataset = "api_logs", enabled = true) => ({
  id: dataset,
  dataset,
  enabled,
  status: 1,
  updateTime: new Date(0),
});
beforeEach(() => {
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repo = {
    policy: vi.fn(async (d) => policy(d)),
    policies: vi.fn().mockResolvedValue([policy(), policy("business_logs", false)]),
  };
  service = new (PlatformLifecycleExecutionIamService as any)(iam, snapshots, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("lifecycle execution authorization", () => {
  it("registers independent platform write actions and explicit routes with all step-up guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/system/data-lifecycle.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [action, path, method] of [
      [run, "policies/{dataset}/run", "run"],
      [batch, "batch/run", "runBatch"],
    ]) {
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        accessLevel: "Write",
        resourceTypes: ["platform/lifecycle-dataset"],
        authorizationBoundary: "platform",
      });
      expect(routes.find((r) => r.key === "POST /v1/data-lifecycle/" + path)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      const text = file.getClassOrThrow("DataLifecycleController").getMethodOrThrow(method).getText();
      for (const marker of [
        "ReplayProtected",
        "TwoFactorChallengeProtected",
        "replayProtectionMiddleware",
        "twoFactorChallengeMiddleware",
      ])
        expect(text).toContain(marker);
    }
  });
  it("uses the fixed action and real dataset and provides reusable revocation checks", async () => {
    const [guard] = await service.prepare(run, ["api_logs"], request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: run, resource: "acs:platform:*:platform:lifecycle-dataset/api_logs" }),
    );
    iam.authorize.mockResolvedValue({ ...allow, decision: "ExplicitDeny" });
    await expect(guard.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preauthorizes every batch target before hydrating any execution policy", async () => {
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ImplicitDeny" });
    await expect(service.prepare(batch, ["api_logs", "business_logs"], request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.policy).not.toHaveBeenCalled();
  });
  it("selects only the enabled policy snapshot for an empty batch", async () => {
    const guards = await service.prepare(batch, [], request);
    expect(guards.map((g) => g.dataset)).toEqual(["api_logs"]);
    expect(iam.authorize.mock.calls.every(([r]: any) => r.action === batch && r.resource.endsWith("/api_logs"))).toBe(
      true,
    );
  });
  it("keeps explicit disabled policies executable manually", async () => {
    repo.policy.mockResolvedValue(policy("api_logs", false));
    expect(await service.prepare(run, ["api_logs"], request)).toHaveLength(1);
  });
  it.each([["unknown"], ["api_logs", "api_logs"], []].map((datasets) => ({ datasets })))(
    "rejects invalid single selection $datasets",
    async ({ datasets }) => {
      await expect(service.prepare(run, datasets, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(iam.loadPolicies).not.toHaveBeenCalled();
    },
  );
  it("rejects OAuth, absent identity and non-execution actions before data lookup", async () => {
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.prepare(run, ["api_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare(run, ["api_logs"], {} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.prepare("quyan:system:data_lifecycle:UpdatePolicy" as any, ["api_logs"], request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.policy).not.toHaveBeenCalled();
  });
  it("fails closed when group eligibility, authorization data or policy version changes", async () => {
    const [guard] = await service.prepare(run, ["api_logs"], request);
    repo.policy.mockResolvedValue({ ...policy(), updateTime: new Date(1) });
    await expect(guard.recheck()).rejects.toMatchObject({ statusCode: 403 });
    repo.policy.mockResolvedValue(policy());
    snapshots.recheck.mockRejectedValue(new Error("fixture unavailable"));
    await expect(guard.recheck()).rejects.toThrow("fixture unavailable");
  });
  it("rejects policy disappearance or disabled status without source operations", async () => {
    repo.policy.mockResolvedValue(null);
    await expect(service.prepare(run, ["api_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
    repo.policy.mockResolvedValue({ ...policy(), status: 0 });
    await expect(service.prepare(run, ["api_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
