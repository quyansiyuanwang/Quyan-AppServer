import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-maintenance-optimize.repository", () => ({
  PlatformMaintenanceOptimizeRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformMaintenanceOptimizeIamService } from "@/services/system/platform-maintenance-optimize-iam.service";
import { platformMaintenanceOptimizeBatchResourceResolver } from "@/iam/request/platform-maintenance-resource-resolvers";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformMaintenanceOptimizeIamService, iam: any, snapshots: any, repo: any, request: TypedRequest<any>;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({
      group: { id: "global-group", updateTime: new Date(0) },
      users: [
        { id: "actor", updateTime: new Date(0) },
        { id: "owner", updateTime: new Date(0) },
      ],
    }),
  };
  repo = { create: vi.fn().mockResolvedValue({ id: "created", runStatus: "queued" }) };
  service = new (PlatformMaintenanceOptimizeIamService as any)(iam, snapshots, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { datasets: ["api_logs"], confirmation: "OPTIMIZE" },
    params: {},
  } as unknown as TypedRequest<any>;
});
describe("maintenance optimize task creation", () => {
  it("registers a write action and retains step-up, replay, CAPTCHA and confirmation", async () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    const file = p.addSourceFileAtPath("src/api/controllers/v1/system/data-maintenance.controller.ts");
    expect(getIamActionDefinition("quyan:system:data_maintenance:CreateOptimizeRun")).toMatchObject({
      accessLevel: "Write",
      sensitive: true,
      authorizationBoundary: "platform",
      resourceTypes: ["platform/maintenance-dataset"],
    });
    expect(
      collectIamRoutes(p.getSourceFiles(), process.cwd()).find((r) => r.key === "POST /v1/data-maintenance/optimize"),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:system:data_maintenance:CreateOptimizeRun"], issues: [] });
    const method = file.getClassOrThrow("DataMaintenanceController").getMethodOrThrow("optimize").getText();
    for (const guard of [
      "TwoFactorChallengeProtected",
      "ReplayProtected",
      "CaptchaProtected",
      "twoFactorChallengeMiddleware",
      "replayProtectionMiddleware",
      "captchaMiddleware",
    ])
      expect(method).toContain(guard);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformMaintenanceOptimizeBatchResourceResolver({ request, principal })).toEqual([
      "acs:platform:*:platform:maintenance-dataset/api_logs",
    ]);
    request.body.confirmation = "OTHER";
    expect(await platformMaintenanceOptimizeBatchResourceResolver({ request, principal })).toBeUndefined();
  });
  it("uses server action and trusted snapshots for every dataset with reusable final recheck", async () => {
    const guard = (await service.prepare(["api_logs", "business_logs", "api_logs"], request))!;
    expect(guard).toMatchObject({
      action: "quyan:system:data_maintenance:CreateOptimizeRun",
      datasets: ["api_logs", "business_logs"],
      users: { targetUserId: "actor" },
    });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: guard.action,
        resources: [
          "acs:platform:*:platform:maintenance-dataset/api_logs",
          "acs:platform:*:platform:maintenance-dataset/business_logs",
        ],
      }),
    );
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }, { decision: "Allow" }]);
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not prepare on one denied target, missing decisions or untrusted identity", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "Allow" }, { decision: "ExplicitDeny" }]);
    await expect(service.prepare(["api_logs", "business_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.prepare(["api_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
    for (const targets of [[], ["invalid"], ["server_logs"], ["ai_request_logs"]])
      await expect(service.prepare(targets, request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.prepare(["api_logs"], request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("shadow prepares metadata without creating any task", async () => {
    expect(await service.prepare(["api_logs"], request, false)).toBeUndefined();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
