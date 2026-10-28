import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-quota-write.repository", () => ({
  PlatformDeveloperQuotaWriteRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture deny", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { Permission, getIamActionDefinition, getIamResourceType } from "@quyan/shared";
import { PlatformDeveloperQuotaWriteIamService } from "@/services/developer/platform-developer-quota-write-iam.service";
import {
  platformDeveloperQuotaArn,
  platformDeveloperQuotaSubjectArn,
} from "@/iam/resources/platform-developer-quota-resources";

import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformDeveloperQuotaWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = {
    create: vi.fn().mockResolvedValue({ id: "entry" }),
    update: vi.fn().mockResolvedValue({ id: "entry" }),
    remove: vi.fn().mockResolvedValue(true),
    target: vi.fn().mockResolvedValue({ id: "entry", model: "provider/model:v1", status: 1, updateTime: new Date(0) }),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({
      group: { id: "global", updateTime: new Date(0) },
      users: [
        { id: "actor", updateTime: new Date(0) },
        { id: "owner", updateTime: new Date(0) },
      ],
    }),
    recheck: vi.fn(),
  };
  service = new (PlatformDeveloperQuotaWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperQuotaWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:oj:DeletePricing" },
  } as unknown as TypedRequest;
});
const body = { subjectType: "user" as const, subjectId: "target-user", service: "ip" as const, dailyFreeQuota: 100 };
describe("platform developer quota write authorization", () => {
  beforeEach(() => {
    repo.prepare = vi.fn().mockResolvedValue({ subject: { ...body, users: [] }, target: null });
    repo.upsert = vi.fn().mockResolvedValue({ id: "entry" });
    repo.target.mockResolvedValue({
      id: "entry",
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      service: body.service,
      status: 1,
      updateTime: new Date(0),
    });
  });
  it("checks the subject creation boundary and actual generated record", async () => {
    await service.upsert(body, "actor", request);
    const guard = repo.upsert.mock.calls[0][2];
    expect(guard.permission).toBe(Permission.DEVELOPER_QUOTA_MANAGE);
    await guard.recheckEntry("entry");
    expect(iam.authorize.mock.calls.map((call: any) => [call[0].action, call[0].resource])).toEqual([
      ["quyan:developer:UpsertQuotaOverride", platformDeveloperQuotaSubjectArn("user", "target-user", "ip")],
      ["quyan:developer:UpsertQuotaOverride", platformDeveloperQuotaArn("entry")],
    ]);
  });
  it("also checks existing IDs before updating or restoring an override", async () => {
    repo.prepare.mockResolvedValue({ subject: { ...body, users: [] }, target: { id: "entry" } });
    await service.upsert(body, "actor", request);
    expect(iam.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "quyan:developer:UpsertQuotaOverride",
        resource: platformDeveloperQuotaArn("entry"),
      }),
    );
  });
  it("uses the actual record ID for deletion regardless of a spoofed Action header", async () => {
    await service.remove("entry", "actor", request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:developer:DeleteQuotaOverride",
        resource: platformDeveloperQuotaArn("entry"),
      }),
    );
    expect(repo.remove).toHaveBeenCalled();
  });
  it.each([undefined, { decision: "ExplicitDeny" }, { decision: "ImplicitDeny" }])(
    "fails closed on invalid decisions: %j",
    async (decision) => {
      iam.authorize.mockResolvedValue(decision);
      await expect(service.upsert(body, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.upsert).not.toHaveBeenCalled();
    },
  );
  it("rejects missing principal, actor spoofing and OAuth tokens", async () => {
    await expect(service.upsert(body, "other", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.upsert(body, "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.upsert(body, "actor", { ...request, oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects unknown fields, negative quotas and mismatched prepared subjects", async () => {
    for (const value of [
      { ...body, accountOwnerId: "other" },
      { ...body, dailyFreeQuota: -1 },
      { ...body, service: "unknown" },
    ])
      await expect(service.upsert(value as any, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    repo.prepare.mockResolvedValue({ subject: { ...body, subjectId: "other" }, target: null });
    await expect(service.upsert(body, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects missing or rebound deletion targets before persistence", async () => {
    repo.target.mockResolvedValue(null);
    await expect(service.remove("entry", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValue({ id: "other", status: 1 });
    await expect(service.remove("entry", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("shadow rechecks identity without writing", async () => {
    await service.upsert(body, "actor", request, false);
    await service.remove("entry", "actor", request, false);
    expect(identities.recheck).toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("maps all-service scope to a concrete all segment instead of a wildcard", () => {
    expect(platformDeveloperQuotaSubjectArn("project", "project", "*")).toBe(
      "acs:platform:*:platform:developer-quota-subject/project/project/all",
    );
    expect(getIamResourceType(platformDeveloperQuotaSubjectArn("project", "project", "*"))?.accountScope).toBe(
      "platform",
    );
    expect(() => platformDeveloperQuotaSubjectArn("user", "bad/id", "ip")).toThrow();
  });
  it("registers fixed native actions and preserves replay middleware", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-quota-admin.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "upsert")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:UpsertQuotaOverride"],
      resourceKind: "batch",
      issues: [],
    });
    expect(routes.find((r) => r.method === "remove")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:DeleteQuotaOverride"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:developer:UpsertQuotaOverride")?.authorizationBoundary).toBe("platform");
    expect(file.getText().match(/replayProtectionMiddleware,/g)?.length).toBe(2);
  });
});
