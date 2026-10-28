import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-config-write.repository", () => ({
  PlatformDeveloperConfigWriteRepository: { getInstance: vi.fn() },
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
import { PlatformDeveloperConfigWriteIamService } from "@/services/developer/platform-developer-config-write-iam.service";
import {
  platformDeveloperConfigArn,
  platformDeveloperConfigControlArn,
} from "@/iam/resources/platform-developer-config-resources";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const body = { enabled: true, defaultDailyQuota: 100, overagePrice: 1.25, defaultInstanceLimit: 2, retentionDays: 30 };
let service: PlatformDeveloperConfigWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = { target: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: "entry" }) };
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
  service = new (PlatformDeveloperConfigWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperConfigWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:developer:ListProductConfigurations" },
  } as unknown as TypedRequest;
});
describe("platform product configuration writes", () => {
  it("checks the trusted product scope and generated record with a fixed server action", async () => {
    await service.upsert("kv", body, "actor", request);
    const guard = repo.upsert.mock.calls[0][3];
    expect(guard.permission).toBe(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE);
    await guard.recheckEntry("entry");
    expect(iam.authorize.mock.calls.map((c: any) => [c[0].action, c[0].resource])).toEqual([
      ["quyan:developer:UpsertProductConfiguration", platformDeveloperConfigControlArn("kv")],
      ["quyan:developer:UpsertProductConfiguration", platformDeveloperConfigArn("entry")],
    ]);
  });
  it("checks the actual existing record before updating or restoring it", async () => {
    repo.target.mockResolvedValue({ id: "entry", productCode: "kv", status: -1, updateTime: new Date(0) });
    await service.upsert("kv", body, "actor", request);
    expect(iam.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: platformDeveloperConfigArn("entry") }),
    );
  });
  it.each(["ImplicitDeny", "ExplicitDeny"])("blocks %s before looking up the target", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.upsert("kv", body, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.target).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("does not persist when a specific record is denied", async () => {
    repo.target.mockResolvedValue({ id: "entry", productCode: "kv", status: 1, updateTime: new Date(0) });
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.upsert("kv", body, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects missing, mismatched and OAuth identities", async () => {
    await expect(service.upsert("kv", body, "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.upsert("kv", body, "other", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.upsert("kv", body, "actor", { ...request, oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects invalid products, forged owner fields and invalid limits", async () => {
    await expect(service.upsert("unknown" as any, body, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    for (const invalid of [
      { ...body, accountOwnerId: "other" },
      { ...body, overagePrice: -1 },
      { ...body, defaultInstanceLimit: 0 },
      { ...body, defaultDailyQuota: Infinity },
    ])
      await expect(service.upsert("kv", invalid as any, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects a rebound product or malformed record snapshot", async () => {
    for (const target of [
      { id: "entry", productCode: "push", updateTime: new Date(0) },
      { id: "bad/id", productCode: "kv", updateTime: new Date(0) },
      { id: "entry", productCode: "kv", updateTime: new Date(NaN) },
    ]) {
      repo.target.mockResolvedValue(target);
      await expect(service.upsert("kv", body, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rechecks identity and policy without persistence in shadow", async () => {
    expect(await service.upsert("kv", body, "actor", request, false)).toBeUndefined();
    expect(identities.recheck).toHaveBeenCalledTimes(2);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("fails closed when evaluation or identity recheck is unavailable", async () => {
    iam.authorize.mockRejectedValueOnce(new Error("fixture outage"));
    await expect(service.upsert("kv", body, "actor", request)).rejects.toThrow("fixture outage");
    identities.recheck.mockRejectedValue(new Error("fixture revoke"));
    await expect(service.upsert("kv", body, "actor", request, false)).rejects.toThrow("fixture revoke");
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("registers platform resource types and rejects untrusted product identifiers", () => {
    expect(platformDeveloperConfigControlArn("kv")).toBe("acs:platform:*:platform:developer-product-config-control/kv");
    expect(getIamResourceType(platformDeveloperConfigControlArn("kv"))?.accountScope).toBe("platform");
    expect(() => platformDeveloperConfigControlArn("kv/*" as any)).toThrow();
    expect(getIamActionDefinition("quyan:developer:UpsertProductConfiguration")?.resourceTypes).toEqual([
      "platform/developer-product-config-control",
      "platform/developer-product-config",
    ]);
  });
  it("declares native batch metadata and retains replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((r) => r.method === "updateConfig"),
    ).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:UpsertProductConfiguration"],
      resourceKind: "batch",
      issues: [],
    });
    expect(
      file.getClassOrThrow("DeveloperProductAdminController").getMethodOrThrow("updateConfig").getText(),
    ).toContain("replayProtectionMiddleware");
  });
});
