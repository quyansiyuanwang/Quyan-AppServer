import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-account-write.repository", () => ({
  PlatformDeveloperAccountWriteRepository: { getInstance: vi.fn() },
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
import { PlatformDeveloperAccountWriteIamService } from "@/services/developer/platform-developer-account-write-iam.service";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
} from "@/iam/resources/platform-developer-account-resources";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const body = { dailyFreeQuota: 100, overageEnabled: true, instanceLimit: 2 };
const preparation = (target: any = null) => ({
  owner: { id: "target-owner", status: 1, userType: "root", accountOwnerId: null, updateTime: new Date(0) },
  config: { id: "config", productCode: "kv", status: 1, updateTime: new Date(0) },
  target,
});
let service: PlatformDeveloperAccountWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = { prepare: vi.fn().mockResolvedValue(preparation()), upsert: vi.fn().mockResolvedValue({ id: "entry" }) };
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
  service = new (PlatformDeveloperAccountWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperAccountWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:developer:ListProductConfigurations" },
  } as unknown as TypedRequest;
});
describe("platform product account writes", () => {
  it("checks the trusted product scope and generated record with a fixed server action", async () => {
    await service.upsert("kv", "target-owner", body, "actor", request);
    const guard = repo.upsert.mock.calls[0][4];
    expect(guard.permission).toBe(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE);
    await guard.recheckEntry("entry");
    expect(iam.authorize.mock.calls.map((c: any) => [c[0].action, c[0].resource])).toEqual([
      ["quyan:developer:UpsertProductAccount", platformDeveloperAccountScopeArn("target-owner", "kv")],
      ["quyan:developer:UpsertProductAccount", platformDeveloperAccountArn("entry")],
    ]);
  });
  it("checks the actual existing record before updating or restoring it", async () => {
    repo.prepare.mockResolvedValue(
      preparation({
        id: "entry",
        accountOwnerId: "target-owner",
        productCode: "kv",
        status: -1,
        updateTime: new Date(0),
      }),
    );
    await service.upsert("kv", "target-owner", body, "actor", request);
    expect(iam.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: platformDeveloperAccountArn("entry") }),
    );
  });
  it.each(["ImplicitDeny", "ExplicitDeny"])("blocks %s before looking up the target", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.upsert("kv", "target-owner", body, "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.prepare).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("does not persist when a specific record is denied", async () => {
    repo.prepare.mockResolvedValue(
      preparation({
        id: "entry",
        accountOwnerId: "target-owner",
        productCode: "kv",
        status: 1,
        updateTime: new Date(0),
      }),
    );
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.upsert("kv", "target-owner", body, "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects missing, mismatched and OAuth identities", async () => {
    await expect(service.upsert("kv", "target-owner", body, "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.upsert("kv", "target-owner", body, "other", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.upsert("kv", "target-owner", body, "actor", { ...request, oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects invalid products, forged owner fields and invalid limits", async () => {
    await expect(service.upsert("unknown" as any, "target-owner", body, "actor", request)).rejects.toMatchObject({
      statusCode: 400,
    });
    for (const invalid of [
      { ...body, accountOwnerId: "other" },
      { ...body, dailyFreeQuota: -1 },
      { ...body, instanceLimit: 0 },
      { ...body, dailyFreeQuota: Infinity },
    ])
      await expect(service.upsert("kv", "target-owner", invalid as any, "actor", request)).rejects.toMatchObject({
        statusCode: 400,
      });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rejects a rebound product or malformed record snapshot", async () => {
    for (const target of [
      { id: "entry", productCode: "push", updateTime: new Date(0) },
      { id: "bad/id", productCode: "kv", updateTime: new Date(0) },
      { id: "entry", productCode: "kv", updateTime: new Date(NaN) },
    ]) {
      repo.prepare.mockResolvedValue(preparation({ ...target, accountOwnerId: "target-owner" }));
      await expect(service.upsert("kv", "target-owner", body, "actor", request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("rechecks identity and policy without persistence in shadow", async () => {
    expect(await service.upsert("kv", "target-owner", body, "actor", request, false)).toBeUndefined();
    expect(identities.recheck).toHaveBeenCalledTimes(2);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("fails closed when evaluation or identity recheck is unavailable", async () => {
    iam.authorize.mockRejectedValueOnce(new Error("fixture outage"));
    await expect(service.upsert("kv", "target-owner", body, "actor", request)).rejects.toThrow("fixture outage");
    identities.recheck.mockRejectedValue(new Error("fixture revoke"));
    await expect(service.upsert("kv", "target-owner", body, "actor", request, false)).rejects.toThrow("fixture revoke");
    expect(repo.upsert).not.toHaveBeenCalled();
  });
  it("registers platform resource types and rejects untrusted product identifiers", () => {
    expect(platformDeveloperAccountScopeArn("target-owner", "kv")).toBe(
      "acs:platform:*:platform:developer-product-account-scope/target-owner/kv",
    );
    expect(getIamResourceType(platformDeveloperAccountScopeArn("target-owner", "kv"))?.accountScope).toBe("platform");
    expect(() => platformDeveloperAccountScopeArn("target-owner", "kv/*" as any)).toThrow();
    expect(getIamActionDefinition("quyan:developer:UpsertProductAccount")?.resourceTypes).toEqual([
      "platform/developer-product-account-scope",
      "platform/developer-product-account",
    ]);
  });
  it("declares native batch metadata and retains replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((r) => r.method === "updateManagedAccount"),
    ).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:developer:UpsertProductAccount"],
      resourceKind: "batch",
      issues: [],
    });
    expect(
      file.getClassOrThrow("DeveloperProductAdminController").getMethodOrThrow("updateManagedAccount").getText(),
    ).toContain("replayProtectionMiddleware");
  });
});
